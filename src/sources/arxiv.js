/**
 * arXiv source — fetches recent AI/ML paper abstracts.
 *
 * arXiv is the ground truth for model/benchmark claims. Papers are primary
 * sources: exact numbers, methods, and results that tweets only paraphrase.
 *
 * Fetches from cs.AI, cs.LG, cs.CL (NLP), and cs.CV (vision) — the four
 * categories that cover virtually all LLM and agent research.
 *
 * Returns: Array<{ text, title, url, pubDate, authors, source, sourceTier }>
 */

const { fetchUrl } = require('./fetch');

const ARXIV_FEEDS = [
  // { name: 'arXiv cs.AI',  url: 'https://rss.arxiv.org/rss/cs.AI'  },
  // { name: 'arXiv cs.LG',  url: 'https://rss.arxiv.org/rss/cs.LG'  },
  // { name: 'arXiv cs.CL',  url: 'https://rss.arxiv.org/rss/cs.CL'  },
];

// Only keep papers whose title/abstract touches practical AI topics
const RELEVANCE_KEYWORDS = [
  'large language model', 'llm', 'language model', 'transformer',
  'instruction tun', 'fine-tun', 'reinforcement learning from human',
  'rlhf', 'reasoning', 'chain-of-thought', 'agent', 'multimodal',
  'retrieval', 'rag', 'benchmark', 'evaluation', 'inference',
  'alignment', 'safety', 'hallucination', 'code generation',
  'vision language', 'diffusion', 'embedding', 'context',
];

function isPracticallyRelevant(text) {
  const lower = text.toLowerCase();
  return RELEVANCE_KEYWORDS.some((kw) => lower.includes(kw));
}

function parseArxivFeed(xml, feedName) {
  const items = [];
  const itemRe   = /<item[\s\S]*?<\/item>/gi;
  const titleRe  = /<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i;
  const descRe   = /<description[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/i;
  const linkRe   = /<link>(https?:\/\/[^<]+)<\/link>/i;
  const dateRe   = /<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i;

  let m;
  while ((m = itemRe.exec(xml)) !== null) {
    const block  = m[0];
    const title  = (titleRe.exec(block)?.[1] || '').replace(/<[^>]+>/g, '').trim();
    const desc   = (descRe.exec(block)?.[1]  || '').replace(/<[^>]+>/g, '').trim().slice(0, 1000);
    const url    = linkRe.exec(block)?.[1]?.trim() || null;
    const date   = dateRe.exec(block)?.[1];

    // Skip generic feed-header items
    if (!title || title.length < 15 || !desc || desc.length < 50) continue;
    if (!isPracticallyRelevant(`${title} ${desc}`)) continue;

    items.push({
      text:       `[arXiv] ${title}. Abstract: ${desc}`,
      title,
      url,
      pubDate:    date ? new Date(date.trim()) : null,
      source:     feedName,
      sourceTier: 1, // Papers are primary sources
    });
  }
  return items;
}

async function fetchArxiv() {
  console.log('\n📄 Fetching arXiv papers...');
  const results = [];

  await Promise.allSettled(ARXIV_FEEDS.map(async ({ name, url }) => {
    try {
      const xml = await fetchUrl(url, 12000);
      const items = parseArxivFeed(xml, name);
      console.log(`  ✓ ${name}: ${items.length} relevant papers`);
      results.push(...items);
    } catch (err) {
      console.warn(`  ✗ ${name}: ${err.message}`);
    }
  }));

  return results;
}

module.exports = { fetchArxiv };
