/**
 * News orchestrator — finds the best AI story from all sources,
 * enriches it with the full article, and returns a structured bundle
 * ready to pass to the AI generator.
 *
 * Source priority:
 *   Tier 1 (official blogs, arXiv papers) → highest base score bonus
 *   Tier 2 (HN, news outlets, HuggingFace) → medium bonus
 *   Tier 3 (Twitter) → signal detection, no bonus (but still valid)
 */

const { spawn }              = require('child_process');
const config                 = require('./config');
const { hashText, load: loadHashes } = require('./store');
const { getAllTopics, addDiscoveredTopics, extractTopicsFromText } = require('./topics');
const { fetchAllRss }        = require('./sources/rss');
const { fetchHackerNews }    = require('./sources/hackernews');
const { fetchArxiv }         = require('./sources/arxiv');
const { fetchHuggingFace }   = require('./sources/huggingface');
const { fetchWebCrawlerNews } = require('./sources/web-crawler');
const { fetchGitHubTrending } = require('./sources/github-trending');
const { fetchDevTo }         = require('./sources/devto');
const { fetchLobsters }      = require('./sources/lobsters');
const { fetchReddit }        = require('./sources/reddit');
const { fetchProductHunt }   = require('./sources/product-hunt');
const { fetchTopicSearch }   = require('./sources/topic-search');
const { enrichWithArticles } = require('./sources/article');
const { selectWithRotation } = require('./rotation');

const MIN_SCORE = 5;

// ─── Scoring (Quality-Based, No Keywords) ─────────────────────────────────────

function scoreItem(item) {
  const { text, pubDate, sourceTier, hnScore, hfLikes, articleText, url } = item;

  // Hard filters (quality gates, not keywords)
  if (!text || text.replace(/\s/g, '').length < 80) return -99;  // Minimum length
  if (/^rt @/i.test(text.trim())) return -99;  // Retweets
  if (text.length > 5000) return -99;  // Likely spam or noise

  let score = 0;

  // ─── 1. SOURCE AUTHORITY (30%) ──────────────────────────────────────────────

  // Tier-based authority
  const sourceScore = {
    1: 10,    // Official sources (arxiv, blogs)
    2: 6,     // Community platforms (HN, HF)
    3: 2,     // Social media
  }[sourceTier] || 0;
  
  score += sourceScore;

  // Factor: Does it have a real URL/link? (Sign of credibility)
  if (url && /^https?:\/\//.test(url)) score += 2;

  // ─── 2. COMMUNITY SIGNALS (40%) ────────────────────────────────────────────

  // HN score: Real community validation
  if (hnScore && hnScore > 0) {
    const hnBoost = Math.min(hnScore / 15, 10);  // Cap at 10 points
    score += hnBoost;
  }

  // HuggingFace popularity: Real user engagement
  if (hfLikes && hfLikes > 0) {
    const hfBoost = Math.min(hfLikes / 30, 8);  // Cap at 8 points
    score += hfBoost;
  }

  // ─── 3. CONTENT QUALITY (25%) ──────────────────────────────────────────────

  // Text length indicates substance (longer = more informative, if not spam)
  const textLength = text.length;
  const lengthScore = Math.min(textLength / 200, 4);  // Cap at 4 points
  score += lengthScore;

  // Information density: Numbers, metrics, data points
  const numbers = (text.match(/\d+(?:\.\d+)?/g) || []).length;
  const numberScore = Math.min(numbers * 0.3, 3);  // Cap at 3 points
  score += numberScore;

  // References to external sources (URLs in text)
  const urlsInText = (text.match(/https?:\/\/\S+|www\.\S+/g) || []).length;
  const urlScore = Math.min(urlsInText * 0.5, 2);  // Cap at 2 points
  score += urlScore;

  // Sentence complexity (longer average sentences = more detail)
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
  const avgLength = sentences.length > 0 ? textLength / sentences.length : 0;
  const complexityScore = avgLength > 50 ? 1 : 0;  // Standard technical writing
  score += complexityScore;

  // Full article available? (Indicates thorough research)
  if (articleText && articleText.length > 200) score += 3;

  // ─── 4. FRESHNESS (5%) ─────────────────────────────────────────────────────

  if (pubDate && !isNaN(pubDate.getTime())) {
    const ageHours = (Date.now() - pubDate.getTime()) / 3_600_000;
    
    // Prefer recent, but don't penalize older quality content too much
    let freshnessMultiplier = 1.0;
    if (ageHours < 6) freshnessMultiplier = 1.3;
    else if (ageHours < 24) freshnessMultiplier = 1.15;
    else if (ageHours < 72) freshnessMultiplier = 1.0;
    else if (ageHours < 168) freshnessMultiplier = 0.85;  // 1 week
    else freshnessMultiplier = 0.7;  // Older content
    
    score *= freshnessMultiplier;
  }

  return score;
}

// ─── Twitter via `bird` CLI ───────────────────────────────────────────────────

function fetchFromBird(topic) {
  return new Promise((resolve) => {
    const args = ['search', topic, '--plain'];
    if (config.twitter.authToken) args.push('--auth-token', config.twitter.authToken);
    if (config.twitter.ct0)       args.push('--ct0',        config.twitter.ct0);

    const bird = spawn('bird', args);
    let stdout = '';

    bird.stdout.on('data', (d) => (stdout += d.toString()));
    bird.stderr.on('data', () => {});

    const timer = setTimeout(() => { bird.kill(); resolve(''); }, 25000);
    bird.on('close', (code) => { clearTimeout(timer); resolve(code === 0 ? stdout : ''); });
  });
}

function parseBirdOutput(raw) {
  const NOISE = [/^url:/i, /^https?:\/\//, /^@/, /────/, /^PHOTO:/i, /pbs\.twimg\.com/i, /t\.co\//i, /^RT @/i];
  const lines = raw.split('\n').map((l) => l.trim()).filter((l) => l.length >= 20 && !NOISE.some((p) => p.test(l)));

  const tcoUrls = [...new Set(raw.match(/https?:\/\/t\.co\/\S+/g) || [])];

  const items = [];
  let buffer  = [];
  for (const line of lines) {
    buffer.push(line);
    if (buffer.length >= 3) {
      const text = buffer.join(' ').trim();
      if (text.length >= 80) items.push({ text, pubDate: null, source: 'Twitter', sourceTier: 3, tcoUrls });
      buffer = [];
    }
  }
  if (buffer.length > 0) {
    const text = buffer.join(' ').trim();
    if (text.length >= 80) items.push({ text, pubDate: null, source: 'Twitter', sourceTier: 3, tcoUrls });
  }
  return items;
}

async function fetchTwitterTopics(topics, maxTopics = 6) {
  const shuffled = [...topics].sort(() => Math.random() - 0.5).slice(0, maxTopics);
  const items    = [];

  for (let i = 0; i < shuffled.length; i++) {
    const topic = shuffled[i];
    console.log(`\n🐦 Twitter (${i + 1}/${shuffled.length}): "${topic}"`);
    const raw    = await fetchFromBird(topic);
    const parsed = parseBirdOutput(raw);
    console.log(`   ${parsed.length} items`);
    items.push(...parsed);
  }
  return items;
}

// ─── Main orchestrator ────────────────────────────────────────────────────────

async function findBestStory() {
  const publishedHashes = loadHashes();
  console.log(`\n📋 Published so far: ${publishedHashes.size} stories`);

  // 1. Fetch all sources in parallel
  console.log('\n🌐 Gathering news from all sources...');

  const [rssItems, hnItems, arxivItems, hfResult, webItems, gitHubItems, devtoItems, lobstersItems, redditItems, productHuntItems] = await Promise.all([
    fetchAllRss(),
    fetchHackerNews(50, 80),
    fetchArxiv(),
    fetchHuggingFace(),
    fetchWebCrawlerNews(),
    fetchGitHubTrending(),
    fetchDevTo(),
    fetchLobsters(),
    fetchReddit(),
    fetchProductHunt(),
  ]);

  const hfItems       = hfResult.items;
  const trendingNames = hfResult.trendingNames;

  // Log source summary
  console.log('\n📊 Source Summary:');
  console.log(`  📰 RSS Feeds: ${rssItems.length} items`);
  console.log(`  🔶 Hacker News: ${hnItems.length} items`);
  console.log(`  📄 arXiv: ${arxivItems.length} items`);
  console.log(`  🤗 HuggingFace: ${hfItems.length} items`);
  console.log(`  🕷️  Web Crawlers: ${webItems.length} items`);
  console.log(`  📍 GitHub Trending: ${gitHubItems.length} items`);

  console.log(`  👨‍💻 Dev.to: ${devtoItems.length} items`);
  console.log(`  🦞 Lobsters: ${lobstersItems.length} items`);
  console.log(`  🤖 Reddit: ${redditItems.length} items`);
  console.log(`  🚀 Product Hunt: ${productHuntItems.length} items`);

  // 2. Update dynamic topic pool from HF + HN discoveries
  const hnNames = hnItems.map((i) => i.title).flatMap((t) => extractTopicsFromText(t));
  addDiscoveredTopics([...trendingNames, ...hnNames]);

  // 3. Fetch Twitter with full topic pool (seeds + dynamic), filtered by focus topic if set
  const focusTopic = config.focusTopic ? config.focusTopic.toLowerCase() : '';
  let allTopics = getAllTopics();
  if (focusTopic) {
    const focused = allTopics.filter((t) => t.toLowerCase().includes(focusTopic));
    // Always search the raw focusTopic directly; supplement with pool matches if any
    allTopics = [config.focusTopic, ...focused.filter((t) => t !== config.focusTopic)];
    console.log(`\n🎯 Topic focus: "${config.focusTopic}" — using ${allTopics.length} matching topics for Twitter`);
  }
  const tweetItems = await fetchTwitterTopics(allTopics, 6);

  // 3b. If a focus topic is set, run targeted keyword searches for extra candidates
  let topicSearchItems = [];
  if (focusTopic) {
    topicSearchItems = await fetchTopicSearch(config.focusTopic);
    console.log(`  🎯 Topic search added ${topicSearchItems.length} extra candidates`);
  } else {
    // Even without a focus topic, search a few dynamic topics via arXiv+HN
    // so newly discovered models (BitNet, etc.) get picked up every run.
    const allTopics = getAllTopics();
    const sample = [...allTopics].sort(() => Math.random() - 0.5).slice(0, 4);
    console.log(`\n🔍 Auto topic search for: ${sample.join(', ')}`);
    const extras = await Promise.all(sample.map((t) => fetchTopicSearch(t).catch(() => [])));
    topicSearchItems = extras.flat();
    console.log(`  ✅ Auto topic search added ${topicSearchItems.length} extra candidates`);
  }

  // 4. Merge, deduplicate against published
  const allItems = [...rssItems, ...hnItems, ...arxivItems, ...hfItems, ...webItems, ...gitHubItems, ...devtoItems, ...lobstersItems, ...redditItems, ...productHuntItems, ...tweetItems, ...topicSearchItems];
  const fresh    = allItems.filter((item) => !publishedHashes.has(hashText(item.text)));

  console.log(`\n📦 Total candidates: ${allItems.length} (${fresh.length} unpublished)`);
  if (!fresh.length) throw new Error('No fresh stories found across all sources');

  // 5. Basic quality filtering (no spam, not too short, not Pentagon-related)
  const valid = fresh.filter((item) => {
    const lower = item.text.toLowerCase();
    // Reject obvious spam and low-quality items
    if (/^rt @/i.test(item.text.trim())) return false;
    if (/follow me|click here|use code|promo|discount|affiliate/i.test(lower)) return false;
    if (item.text.replace(/\s/g, '').length < 80) return false;
    if (/pentagon/i.test(lower)) return false;
    // Topic focus filter: keep only items whose text/title contains the keyword
    if (focusTopic) {
      const haystack = ((item.title || '') + ' ' + item.text).toLowerCase();
      if (!haystack.includes(focusTopic)) return false;
    }
    return true;
  });

  if (!valid.length) throw new Error('No valid candidates after basic filtering');

  console.log(`\n✅ Valid candidates: ${valid.length}`);
  console.log('\n📰 Available articles across all sources:');
  valid.slice(0, 5).forEach((c, i) => {
    console.log(`  ${i + 1}. [${c.source}] ${c.text.slice(0, 80)}...`);
  });

  // 5. Randomly select from all valid candidates (no quality filtering)
  console.log(`\n🎲 Randomly selecting from all ${valid.length} candidates...`);
  const winner = valid[Math.floor(Math.random() * valid.length)];

  // 7. Enrich winner with full article text
  const toEnrich = [winner, ...valid.filter((c) => c !== winner).sort(() => Math.random() - 0.5).slice(0, 3)];
  toEnrich.forEach((c) => {
    if (!c.url && c.tcoUrls && c.tcoUrls.length > 0) c.url = c.tcoUrls[0];
  });
  await enrichWithArticles(toEnrich, toEnrich.length);

  console.log(`\n🏆 Winner selected (random from all candidates):`);
  console.log(`    [${winner.source}]`);
  console.log(`    ${winner.title || winner.text.slice(0, 80)}`);
  if (winner.articleText) console.log(`    Full article available: ${winner.articleText.length} chars`);

  // 8. Build the content bundle for the generator
  return buildBundle(winner);
}

// Helper: Explain scoring in human-readable format
function getScoreBreakdown(item) {
  const factors = [];
  
  const { sourceTier, hnScore, hfLikes, text, articleText, url } = item;
  
  // Source
  if (sourceTier === 1) factors.push('Official source');
  else if (sourceTier === 2) factors.push('Community platform');
  else factors.push('Social signal');
  
  // Community signals
  if (hnScore && hnScore > 20) factors.push(`HN: ${hnScore} points`);
  if (hfLikes && hfLikes > 10) factors.push(`Popular: ${hfLikes} likes`);
  
  // Content quality
  if (text.length > 300) factors.push('Substantial');
  const numbers = (text.match(/\d+/g) || []).length;
  if (numbers > 5) factors.push(`Data-rich: ${numbers} numbers`);
  
  if (articleText && articleText.length > 200) factors.push('Full article');
  
  return factors.join(' • ');
}

function buildBundle(story) {
  const parts = [];

  if (story.title && story.title !== story.text) {
    parts.push(`HEADLINE: ${story.title}`);
    parts.push('');
  }

  // Strip leading [SourceName] prefix from text so the AI doesn't see the origin
  const cleanText = story.text.replace(/^\[[^\]]+\]\s*/, '');

  parts.push('CONTENT:');
  parts.push(cleanText);

  if (story.articleText) {
    parts.push('');
    parts.push('FULL ARTICLE:');
    parts.push(story.articleText);
  }

  return parts.join('\n');
}

module.exports = { findBestStory };
