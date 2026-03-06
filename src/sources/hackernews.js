/**
 * Hacker News source — fetches top AI-relevant stories via the official API.
 *
 * HN is free, no auth required, and the community heavily upvotes AI content.
 * A story with 100+ points has already been vetted by thousands of engineers.
 *
 * Returns: Array<{ text, title, url, pubDate, score, comments, source, sourceTier }>
 */

const { fetchUrl } = require('./fetch');

const HN_API = 'https://hacker-news.firebaseio.com/v0';

// Keywords that make a story AI-relevant
const AI_KEYWORDS = [
  'gpt', 'llm', 'claude', 'gemini', 'llama', 'mistral', 'deepseek', 'qwen', 'grok',
  'openai', 'anthropic', 'deepmind', 'hugging face', 'huggingface',
  'transformer', 'diffusion', 'stable diffusion', 'midjourney',
  'ai ', ' ai', 'artificial intelligence', 'machine learning', 'neural',
  'inference', 'fine-tun', 'rag ', 'embedding', 'multimodal', 'reasoning model',
  'cursor ', 'copilot', 'devin', 'agentic', 'mcp ', 'langchain', 'ollama',
  'benchmark', 'tokens/s', 'context window', 'model weights', 'open-source model',
];

function isAiRelevant(text) {
  const lower = text.toLowerCase();
  return AI_KEYWORDS.some((kw) => lower.includes(kw));
}

async function fetchHackerNews(minScore = 50, maxStories = 80) {
  console.log('\n🔶 Fetching Hacker News...');

  let topIds;
  try {
    const raw = await fetchUrl(`${HN_API}/topstories.json`, 8000);
    topIds = JSON.parse(raw).slice(0, maxStories);
  } catch (err) {
    console.warn(`  ✗ HN top stories: ${err.message}`);
    return [];
  }

  // Fetch story details in parallel, cap concurrency at 10
  const results = [];
  for (let i = 0; i < topIds.length; i += 10) {
    const batch = topIds.slice(i, i + 10);
    const settled = await Promise.allSettled(
      batch.map((id) => fetchUrl(`${HN_API}/item/${id}.json`, 5000).then(JSON.parse))
    );
    for (const r of settled) {
      if (r.status !== 'fulfilled') continue;
      const item = r.value;
      if (!item || item.type !== 'story' || !item.title) continue;
      if ((item.score || 0) < minScore) continue;

      const fullText = [item.title, item.text || ''].join('. ').trim();
      if (!isAiRelevant(fullText)) continue;

      results.push({
        text:       fullText,
        title:      item.title,
        url:        item.url || `https://news.ycombinator.com/item?id=${item.id}`,
        pubDate:    item.time ? new Date(item.time * 1000) : null,
        hnScore:    item.score,
        comments:   item.descendants || 0,
        source:     'Hacker News',
        sourceTier: 2,
      });
    }
  }

  results.sort((a, b) => b.hnScore - a.hnScore);
  console.log(`  ✓ Hacker News: ${results.length} AI stories (min score ${minScore})`);
  return results;
}

module.exports = { fetchHackerNews };
