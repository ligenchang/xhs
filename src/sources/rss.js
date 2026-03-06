/**
 * Structured AI RSS Aggregator
 *
 * Tier 0 — Papers / SOTA
 * Tier 1 — Official Labs
 * Tier 1.5 — Independent Experts
 * Tier 2 — Engineering Media
 * Tier 3 — General Tech Media
 */

const { fetchUrl } = require('./fetch');

// ─────────────────────────────────────────────
// Source Definitions
// ─────────────────────────────────────────────

const FEEDS = [
  // ── Tier 0: Papers / Research ─────────────
  // {
  //   name: 'arXiv AI',
  //   url: 'https://export.arxiv.org/rss/cs.AI',
  //   tier: 0,
  //   type: 'paper',
  //   weight: 5,
  // },
  // {
  //   name: 'arXiv ML',
  //   url: 'https://export.arxiv.org/rss/stat.ML',
  //   tier: 0,
  //   type: 'paper',
  //   weight: 5,
  // },

  // ── Tier 1: Official Labs ──────────────────
  {
    name: 'Google DeepMind',
    url: 'https://deepmind.google/blog/rss.xml',
    tier: 1,
    type: 'lab',
    weight: 4,
  },
  {
    name: 'Meta AI Blog',
    url: 'https://engineering.fb.com/feed/',
    tier: 1,
    type: 'lab',
    weight: 4,
  },
  {
    name: 'Hugging Face Blog',
    url: 'https://huggingface.co/blog/feed.xml',
    tier: 1,
    type: 'lab',
    weight: 4,
  },

  // ── Tier 1.5: Independent Experts ──────────
  {
    name: 'Simon Willison',
    url: 'https://simonwillison.net/atom/entries/',
    tier: 1.5,
    type: 'researcher',
    weight: 4,
  },
  {
    name: 'Latent Space',
    url: 'https://www.latent.space/feed',
    tier: 1.5,
    type: 'researcher',
    weight: 4,
  },
  {
    name: 'Ahead of AI',
    url: 'https://magazine.sebastianraschka.com/feed',
    tier: 1.5,
    type: 'researcher',
    weight: 4,
  },
  {
    name: 'Import AI',
    url: 'https://importai.substack.com/feed',
    tier: 1.5,
    type: 'researcher',
    weight: 4,
  },

  // ── Tier 1.8: AI Tool Launches ─────────────
  {
    name: 'Hacker News (AI)',
    url: 'https://hnrss.org/frontpage',
    tier: 1.8,
    type: 'aggregator',
    weight: 4,
  },
  {
    name: 'The Batch',
    url: 'https://thebatch.substack.com/feed',
    tier: 1.8,
    type: 'researcher',
    weight: 4,
  },

  // ── Tier 2: Engineering Media ──────────────
  {
    name: 'InfoQ AI',
    url: 'https://feed.infoq.com/',
    tier: 2,
    type: 'engineering',
    weight: 3,
  },
  {
    name: 'Ars Technica AI',
    url: 'https://feeds.arstechnica.com/arstechnica/technology-lab',
    tier: 2,
    type: 'engineering',
    weight: 3,
  },

  // ── Tier 3: General Media ──────────────────
  {
    name: 'TechCrunch AI',
    url: 'https://techcrunch.com/category/artificial-intelligence/feed/',
    tier: 3,
    type: 'media',
    weight: 2,
  },
  {
    name: 'MIT Tech Review',
    url: 'https://www.technologyreview.com/feed/',
    tier: 3,
    type: 'media',
    weight: 2,
  },
];

// ─────────────────────────────────────────────
// AI Keyword Filter
// ─────────────────────────────────────────────

const AI_FILTER_KEYWORDS = [
  'ai', 'artificial intelligence', 'machine learning',
  'llm', 'gpt', 'claude', 'gemini',
  'openai', 'anthropic', 'deepmind', 'google ai',
  'neural', 'model', 'inference',
  'generative', 'diffusion',
  'transformer', 'agent', 'agentic',
  'chatgpt', 'copilot', 'cursor', 'perplexity',
  'mistral', 'llama', 'deepseek', 'qwen',
  'embedding', 'vector', 'rag',
  'fine-tune', 'finetune', 'lora',
  'api', 'sdk', 'framework', 'library',
  'tool-use', 'action', 'planning', 'autonomous',
  'reasoning', 'memory', 'function calling',
  'tool calling', 'agentic workflow',
];

function isAiRelevant(text) {
  const lower = text.toLowerCase();
  return AI_FILTER_KEYWORDS.some((kw) => lower.includes(kw));
}

// ─────────────────────────────────────────────
// Basic XML Parser (still regex-based)
// ─────────────────────────────────────────────

function parseRss(xml, source) {
  const items = [];

  const itemRe  = /<item[\s\S]*?<\/item>/gi;
  const entryRe = /<entry[\s\S]*?<\/entry>/gi;
  const blocks = [];

  let m;
  while ((m = itemRe.exec(xml))  !== null) blocks.push(m[0]);
  while ((m = entryRe.exec(xml)) !== null) blocks.push(m[0]);

  const titleRe = /<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i;
  const descRe  = /<(?:description|summary|content)[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/(?:description|summary|content)>/i;
  const dateRe  = /<(?:pubDate|published|updated)[^>]*>([\s\S]*?)<\/(?:pubDate|published|updated)>/i;
  const linkRe  = /<link[^>]*href=["'](https?:\/\/[^"']+)["']|<link[^>]*>(https?:\/\/[^<]+)<\/link>/i;

  for (const block of blocks) {
    const title    = (titleRe.exec(block)?.[1] || '').replace(/<[^>]+>/g, '').trim();
    const desc     = (descRe.exec(block)?.[1]  || '').replace(/<[^>]+>/g, '').trim().slice(0, 800);
    const date     = dateRe.exec(block)?.[1];
    const urlMatch = linkRe.exec(block);
    const url      = (urlMatch?.[1] || urlMatch?.[2] || '').trim();

    if (!title || !desc) continue;

    // Apply AI filter to general aggregators and tool-launch feeds
    if ((source.type === 'media' || source.type === 'aggregator' || source.type === 'tool-launch') 
        && !isAiRelevant(`${title} ${desc}`)) continue;

    items.push({
      id: generateId(title, url),
      title,
      text: `${title}. ${desc}`,
      url: url || null,
      pubDate: date ? new Date(date.trim()) : null,
      source: source.name,
      tier: source.tier,
      type: source.type,
      baseWeight: source.weight,
      score: source.weight,
    });
  }

  return items;
}

// ─────────────────────────────────────────────
// Scoring System (Phase 1)
// ─────────────────────────────────────────────

function scoreItems(items) {
  const now = Date.now();

  return items.map((item) => {
    let score = item.baseWeight;

    // Recency boost
    if (item.pubDate) {
      const hours = (now - item.pubDate.getTime()) / (1000 * 60 * 60);
      if (hours < 24) score += 2;
      else if (hours < 72) score += 1;
    }

    item.score = score;
    return item;
  });
}

// ─────────────────────────────────────────────
// Dedup (basic URL-based)
// ─────────────────────────────────────────────

function dedupe(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (!item.url) return true;
    if (seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  });
}

// ─────────────────────────────────────────────
// Fetch All
// ─────────────────────────────────────────────

async function fetchAllRss() {
  console.log('\n📡 Fetching AI feeds...');
  const results = [];

  await Promise.allSettled(
    FEEDS.map(async (source) => {
      try {
        const xml   = await fetchUrl(source.url, 12000);
        const items = parseRss(xml, source);
        console.log(`  ✓ ${source.name}: ${items.length} items`);
        results.push(...items);
      } catch (err) {
        console.warn(`  ✗ ${source.name}: ${err.message}`);
      }
    })
  );

  const scored  = scoreItems(results);
  const unique  = dedupe(scored);

  return unique.sort((a, b) => b.score - a.score);
}

// ─────────────────────────────────────────────

function generateId(title, url) {
  return require('crypto')
    .createHash('md5')
    .update(title + (url || ''))
    .digest('hex');
}

module.exports = { fetchAllRss };