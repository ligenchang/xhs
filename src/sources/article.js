/**
 * Full-article fetcher — enriches a candidate story by retrieving
 * the complete text from its source URL.
 *
 * A tweet or RSS snippet is ~200 words. The linked article is 800–3000 words
 * and contains the actual numbers, methodology, and quotes the post needs.
 * This single step is the biggest quality multiplier in the pipeline.
 */

const { fetchUrl, resolveUrl, htmlToText } = require('./fetch');

// Sites known to block scrapers or return paywalled content — skip gracefully
const BLOCKED_DOMAINS = [
  'twitter.com', 'x.com', 't.co',
  'nytimes.com', 'wsj.com', 'ft.com', 'bloomberg.com', 'wired.com',
  'medium.com', // often paywalled
];

// How much article text to pass to the model (characters)
// ~4000 chars ≈ ~1000 tokens — enough for the full story, not wasteful
const MAX_ARTICLE_CHARS = 4000;

function isDomainBlocked(url) {
  try {
    const host = new URL(url).hostname.replace('www.', '');
    return BLOCKED_DOMAINS.some((d) => host.includes(d));
  } catch (_) {
    return false;
  }
}

/**
 * Extract the main content from an HTML page.
 * Looks for common article containers first; falls back to full body text.
 */
function extractMainContent(html) {
  // Try to find the main article container
  const articlePatterns = [
    /<article[^>]*>([\s\S]*?)<\/article>/i,
    /<main[^>]*>([\s\S]*?)<\/main>/i,
    /<div[^>]*class="[^"]*(?:article|post|content|body|entry)[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
  ];

  for (const pattern of articlePatterns) {
    const m = pattern.exec(html);
    if (m && m[1].length > 500) {
      return htmlToText(m[1]);
    }
  }

  // Fallback: strip everything and take the body
  return htmlToText(html);
}

/**
 * Given a URL (possibly a t.co redirect), fetch and return the article text.
 * Returns null if the URL is blocked, fails, or yields too little content.
 */
async function fetchArticle(url) {
  if (!url) return null;

  // Resolve short URLs (t.co, bit.ly, etc.)
  const resolvedUrl = await resolveUrl(url);
  if (isDomainBlocked(resolvedUrl)) return null;

  try {
    const html    = await fetchUrl(resolvedUrl, 12000);
    const text    = extractMainContent(html);
    const cleaned = text.slice(0, MAX_ARTICLE_CHARS).trim();

    // Discard if we got too little content (probably a login wall or error page)
    if (cleaned.length < 300) return null;

    return { url: resolvedUrl, text: cleaned };
  } catch (_) {
    return null;
  }
}

/**
 * Enrich a list of candidate stories by fetching their full articles.
 * Only enriches the top N candidates to avoid unnecessary fetches.
 */
async function enrichWithArticles(candidates, topN = 5) {
  const toEnrich = candidates.slice(0, topN);

  console.log(`\n📰 Fetching full articles for top ${toEnrich.length} candidates...`);

  await Promise.allSettled(toEnrich.map(async (candidate) => {
    if (!candidate.url) return;
    const article = await fetchArticle(candidate.url);
    if (article) {
      candidate.articleText = article.text;
      candidate.resolvedUrl = article.url;
      console.log(`  ✓ ${candidate.source}: ${article.text.length} chars from ${article.url.slice(0, 60)}...`);
    }
  }));

  return candidates;
}

module.exports = { fetchArticle, enrichWithArticles };
