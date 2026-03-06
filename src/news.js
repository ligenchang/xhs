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
const { enrichWithArticles } = require('./sources/article');
const { selectWithRotation } = require('./rotation');

const MIN_SCORE = 5;

// ─── Scoring ──────────────────────────────────────────────────────────────────

function scoreItem(item) {
  const { text, pubDate, sourceTier, hnScore, hfLikes } = item;
  const lower = text.toLowerCase();

  // Hard filters
  if (/^rt @/i.test(text.trim()))                                            return -99;
  if (/follow me|click here|use code|promo|discount|affiliate/i.test(lower)) return -99;
  if (text.replace(/\s/g, '').length < 80)                                   return -99;
  if (/pentagon/i.test(lower))                                               return -99;  // Filter out Pentagon-related news

  let score = 0;

  // Source tier bonus
  if (sourceTier === 1) score += 8;
  else if (sourceTier === 2) score += 3;

  // HN community validation
  if (hnScore) score += Math.min(hnScore / 20, 8);

  // HuggingFace popularity
  if (hfLikes) score += Math.min(hfLikes / 50, 4);

  // Breaking news from major labs
  const majorLabs    = ['openai', 'anthropic', 'google deepmind', 'deepmind', 'meta ai', 'mistral', 'xai', 'deepseek', 'cohere'];
  const majorModels  = ['gpt-5', 'gpt-4o', 'o3', 'o4', 'claude 4', 'claude 3', 'gemini 2', 'gemini 3', 'llama 4', 'grok 3', 'deepseek v3', 'phi-4', 'qwen 3'];
  const breakingVerbs = ['release', 'launch', 'announc', 'introduc', 'unveil', 'debut', 'ship'];

  const labMentioned   = majorLabs.some((l) => lower.includes(l));
  const modelMentioned = majorModels.some((m) => lower.includes(m));
  const isBreaking     = breakingVerbs.some((v) => lower.includes(v));

  if ((labMentioned || modelMentioned) && isBreaking) score += 12;
  else if (labMentioned && modelMentioned) score += 8;

  // Agentic AI frameworks (5 pts each) — prioritized
  const agenticFrameworks = [
    'openclaw', 'crewai', 'langgraph', 'autogen', 'dify', 'flowise', 'swarm',
    'smolagents', 'agent framework', 'multi-agent', 'agentic ai', 'agent orchestration',
  ];
  agenticFrameworks.forEach((kw) => { if (lower.includes(kw)) score += 5; });

  // Named AI tools (3 pts each) — cast wider net for emerging tools
  const hotTools = [
    'claude code', 'cursor', 'windsurf', 'devin', 'copilot', 'replit',
    'manus', 'bolt.new', 'v0.dev', 'lovable', 'perplexity', 'chatgpt',
    'claude', 'gemini', 'gpt-4', 'gpt-5', 'deepseek', 'llama', 'mistral',
    'qwen', 'grok', 'ollama', 'groq', 'openrouter', 'langchain',
    'n8n', 'mcp protocol',
    // Emerging tools detection patterns
    'launches ai', 'open source llm', 'new model', 'ai startup',
    'open sources', 'releases new', 'introducing', 'announces', 'debuts',
    'github trending', 'product hunt', 'ycombinator', 'y combinator',
  ];
  hotTools.forEach((kw) => { if (lower.includes(kw)) score += 3; });

  // Technical signals (1.5 pts each)
  const techSignals = [
    'benchmark', 'outperform', 'surpass', 'state-of-the-art', 'sota',
    'context window', 'reasoning', 'agent', 'multimodal', 'fine-tun',
    'inference', 'rag', 'retrieval', 'open-source', 'open source',
    'new model', 'new feature', 'tokens per second', 'cost reduction',
    'latency', 'throughput', 'speculative decoding', 'function calling',
    'tool use', 'mcp', 'model context protocol',
  ];
  techSignals.forEach((kw) => { if (lower.includes(kw)) score += 1.5; });

  // Data richness
  const numbers = text.match(/\d+(\.\d+)?(%|x|×| times| billion| million| trillion| tokens| ms| gb| tb)?/gi);
  score += Math.min((numbers?.length || 0) * 1.5, 7);
  score += Math.min(text.length / 120, 5);

  // Penalties
  if (text.length < 150)                                                       score -= 3;
  if (/excited to announce|thrilled to share|proud to present/i.test(lower))   score -= 2;
  if (/t\.co\/|instagram story/i.test(lower))                                   score -= 8;

  // Freshness multiplier
  if (pubDate && !isNaN(pubDate.getTime())) {
    const ageHours = (Date.now() - pubDate.getTime()) / 3_600_000;
    const mult = ageHours < 2 ? 1.5 : ageHours < 6 ? 1.2 : ageHours < 24 ? 1.0 : ageHours < 72 ? 0.8 : 0.6;
    score *= mult;
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
  // Always search for openclaw first, then add other topics
  const uniqueTopics = ['openclaw', ...topics.filter(t => t.toLowerCase() !== 'openclaw')];
  const shuffled = uniqueTopics.slice(0, maxTopics);
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

  const [rssItems, hnItems, arxivItems, hfResult] = await Promise.all([
    fetchAllRss(),
    fetchHackerNews(50, 80),
    fetchArxiv(),
    fetchHuggingFace(),
  ]);

  const hfItems       = hfResult.items;
  const trendingNames = hfResult.trendingNames;

  // 2. Update dynamic topic pool from HF + HN discoveries
  const hnNames = hnItems.map((i) => i.title).flatMap((t) => extractTopicsFromText(t));
  addDiscoveredTopics([...trendingNames, ...hnNames]);

  // 3. Fetch Twitter with full topic pool (seeds + dynamic)
  const allTopics  = getAllTopics();
  const tweetItems = await fetchTwitterTopics(allTopics, 6);

  // 4. Merge, deduplicate against published
  const allItems = [...rssItems, ...hnItems, ...arxivItems, ...hfItems, ...tweetItems];
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
    return true;
  });

  if (!valid.length) throw new Error('No valid candidates after basic filtering');

  console.log(`\n✅ Valid candidates: ${valid.length}`);
  console.log('\n📰 Random selection from all categories:');
  valid.slice(0, 5).forEach((c, i) => {
    console.log(`  ${i + 1}. [${c.source}] ${c.text.slice(0, 80)}...`);
  });

  // 6. Randomly select winner from valid pool
  const winner = valid[Math.floor(Math.random() * valid.length)];

  // 7. Enrich winner (+ a few random runners-up) with full article text
  const toEnrich = [winner, ...valid.filter((c) => c !== winner).sort(() => Math.random() - 0.5).slice(0, 3)];
  toEnrich.forEach((c) => {
    if (!c.url && c.tcoUrls && c.tcoUrls.length > 0) c.url = c.tcoUrls[0];
  });
  await enrichWithArticles(toEnrich, toEnrich.length);

  console.log(`\n🎲 Winner (randomly selected): [${winner.source}] ${winner.title || winner.text.slice(0, 80)}`);
  if (winner.articleText) console.log(`   Full article: ${winner.articleText.length} chars`);

  // 8. Build the content bundle for the generator
  return buildBundle(winner);
}


function buildBundle(story) {
  const parts = [];

  parts.push(`SOURCE: ${story.source}${story.sourceTier === 1 ? ' (official/primary)' : ''}`);
  if (story.url)     parts.push(`URL: ${story.resolvedUrl || story.url}`);
  if (story.pubDate) parts.push(`DATE: ${story.pubDate.toISOString()}`);
  parts.push('');

  if (story.title && story.title !== story.text) {
    parts.push(`HEADLINE: ${story.title}`);
    parts.push('');
  }

  parts.push('SIGNAL (tweet / snippet):');
  parts.push(story.text);

  if (story.articleText) {
    parts.push('');
    parts.push('FULL ARTICLE:');
    parts.push(story.articleText);
  }

  return parts.join('\n');
}

module.exports = { findBestStory };
