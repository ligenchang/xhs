/**
 * Dev.to Community Content — AI/ML articles from independent developers
 *
 * Fetches articles tagged with AI/ML/LLM from dev.to community platform.
 * High-quality content from active technical writers.
 *
 * Returns: Array<{ text, title, url, pubDate, author, source, sourceTier }>
 */

const { fetchUrl } = require('./fetch');

async function fetchDevTo() {
  console.log('\n👨‍💻 Fetching Dev.to AI articles...');
  const articles = [];
  const seenUrls = new Set();

  try {
    // Dev.to has a public API
    // Fetch top AI-related articles from this week
    const tags = ['ai', 'machinelearning', 'llm', 'deeplearning'];
    
    for (const tag of tags) {
      try {
        const url = `https://dev.to/api/articles?tag=${tag}&per_page=30`;
        const response = await fetchUrl(url, 8000);
        
        let data;
        try {
          data = JSON.parse(response);
        } catch (e) {
          continue;
        }

        if (!Array.isArray(data)) continue;

        data.forEach((article) => {
          if (!article || !article.url || seenUrls.has(article.url)) return;
          if (!article.title || article.title.length < 10) return;

          const title = article.title || '';
          const desc = article.description || article.excerpt || '';
          const author = article.user?.name || article.author?.name || 'Unknown';

          seenUrls.add(article.url);
          articles.push({
            text: `[Dev.to] ${title}. ${desc.slice(0, 200)}`,
            title,
            url: article.url,
            pubDate: article.published_at ? new Date(article.published_at) : new Date(article.created_at),
            author,
            source: 'Dev.to',
            sourceTier: 2,
          });
        });
      } catch (err) {
        // Silent fail for individual tags
      }
    }

    console.log(`  ✓ Dev.to: ${articles.length} AI articles`);
    return articles.slice(0, 25); // Cap at 25 items
  } catch (err) {
    console.log(`  ✓ Dev.to: 0 items (${err.message})`);
    return [];
  }
}

module.exports = { fetchDevTo };
