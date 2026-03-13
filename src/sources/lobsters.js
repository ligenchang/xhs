/**
 * Lobsters — Tech community news aggregator
 *
 * Fetches recent stories from lobste.rs, a tech-focused HN alternative.
 * Better signal-to-noise than HN, with strong moderation and voting system.
 * Filter for AI/ML-related stories.
 *
 * Returns: Array<{ text, title, url, pubDate, score, source, sourceTier }>
 */

const { fetchUrl } = require('./fetch');

async function fetchLobsters() {
  console.log('\n🦞 Fetching Lobsters stories...');
  try {
    // Lobsters has a public API, no auth required
    const url = 'https://lobste.rs/newest.json';
    const response = await fetchUrl(url, 8000);
    
    let data;
    try {
      data = JSON.parse(response);
    } catch (e) {
      console.warn('  ✗ Lobsters: Failed to parse JSON');
      return [];
    }

    if (!Array.isArray(data)) {
      return [];
    }

    const stories = [];
    const aiKeywords = ['ai', 'machine learning', 'llm', 'gpt', 'neural', 
                        'deep learning', 'generative', 'nlp', 'agent', 'transformer',
                        'model', 'inference', 'training', 'pytorch', 'tensorflow',
                        'language model', 'ai model', 'ml', 'artificial intelligence',
                        'hugging face', 'openai', 'anthropic', 'meta ai', 'deepmind'];

    for (const story of data.slice(0, 100)) {
      if (!story || !story.url) continue;

      const title = story.title || '';
      const titleLower = title.toLowerCase();
      const isAI = aiKeywords.some((kw) => titleLower.includes(kw));

      if (!isAI || title.length < 10) continue;

      stories.push({
        text: `[Lobsters] ${title}`,
        title,
        url: story.url,
        pubDate: new Date(story.created_at),
        score: story.score || 0,
        commentCount: story.comment_count || 0,
        source: 'Lobsters',
        sourceTier: 2,
      });
    }

    console.log(`  ✓ Lobsters: ${stories.length} AI stories`);
    return stories.slice(0, 25); // Cap at 25 items
  } catch (err) {
    console.warn(`  ✗ Lobsters: ${err.message}`);
    return [];
  }
}

module.exports = { fetchLobsters };
