/**
 * Full-article fetcher — enriches a candidate story by retrieving
 * the complete text from its source URL.
 *
 * A tweet or RSS snippet is ~200 words. The linked article is 800–3000 words
 * and contains the actual numbers, methodology, and quotes the post needs.
 * This single step is the biggest quality multiplier in the pipeline.
 * 
 * Supports both HTML web pages and PDF documents.
 */

const { fetchUrl, resolveUrl, htmlToText, isPdfUrl } = require('./fetch');

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
    /<div[^>]*class="[^"]*(?:article|post|content|body|entry|main|wrapper|container)[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    // DeepMind and Google blog pattern - look for content sections
    /<h[12][^>]*>[\s\S]{0,200}?<\/h[12]>/i,
  ];

  for (const pattern of articlePatterns) {
    const m = pattern.exec(html);
    if (m && m[1]) {
      const text = htmlToText(m[1]);
      if (text.length > 400) {
        return text;
      }
    }
  }

  // More aggressive fallback: remove only scripts, styles, nav, and footer
  let cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<svg[\s\S]*?<\/svg>/gi, '')
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
    .replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  
  const text = htmlToText(cleaned);
  
  // Return as much text as we can extract, the htmlToText will clean it up
  return text;
}

/**
 * Extract key secondary links from the article content and fetch them too.
 * This adds depth and context to the main article.
 */
function extractSecondaryLinks(html, baseUrl) {
  const links = [];
  
  try {
    // Find all href links in the HTML
    const linkRegex = /href=["']([^"']+)["']/gi;
    let match;
    
    while ((match = linkRegex.exec(html)) !== null) {
      let url = match[1];
      
      // Convert relative URLs to absolute
      if (url.startsWith('/')) {
        try {
          const base = new URL(baseUrl);
          url = `${base.protocol}//${base.host}${url}`;
        } catch (_) {
          continue;
        }
      }
      
      // Filter for relevant links only
      if (url.startsWith('http://') || url.startsWith('https://')) {
        // Skip social media, ads, and tracking
        if (!/twitter|facebook|linkedin|instagram|youtube|reddit|tiktok|ads|tracking|analytics|utm_|googleadservices/i.test(url)) {
          // Prioritize links from same domain and research/paper links
          links.push(url);
        }
      }
    }
  } catch (_) {}
  
  // Return unique links, prioritize research and paper links, limit to top 2
  const prioritized = links.sort((a, b) => {
    const scoreA = /arxiv|paper|research|pdf/.test(a) ? 100 : 0;
    const scoreB = /arxiv|paper|research|pdf/.test(b) ? 100 : 0;
    return scoreB - scoreA;
  });
  
  return [...new Set(prioritized)].slice(0, 2);
}

/**
 * Given a URL (possibly a t.co redirect), fetch and return the article text.
 * Also fetches 1-2 secondary links found in the article for deeper context.
 * Supports both HTML pages and PDF documents.
 * Returns null if the URL is blocked, fails, or yields too little content.
 */
async function fetchArticle(url, includeSecondary = true) {
  if (!url) return null;

  // Resolve short URLs (t.co, bit.ly, etc.)
  const resolvedUrl = await resolveUrl(url);
  if (isDomainBlocked(resolvedUrl)) return null;

  try {
    const isPdf = isPdfUrl(resolvedUrl);
    const html = await fetchUrl(resolvedUrl, 12000);
    
    let text;
    if (isPdf) {
      // For PDFs, fetchUrl already returns extracted text
      text = html.trim();
      console.log(`  📄 PDF extracted: ${text.length} chars`);
    } else {
      // For HTML, extract main content
      text = extractMainContent(html);
    }
    
    const cleaned = text.slice(0, MAX_ARTICLE_CHARS).trim();

    // Discard if we got too little content (probably a login wall or error page)
    // Reduced threshold from 300 to 200 to be more forgiving with JavaScript-heavy sites
    if (cleaned.length < 200) {
      console.log(`  ⚠️ Content too short (${cleaned.length} chars) from ${url.slice(0, 60)}...`);
      return null;
    }

    let finalText = cleaned;

    // Fetch secondary links for deeper context (optional, skip if already have enough content)
    // Skip secondary fetch for PDFs (they're usually already comprehensive)
    if (includeSecondary && !isPdf && cleaned.length < 2000) {
      const secondaryLinks = extractSecondaryLinks(html, resolvedUrl);
      
      if (secondaryLinks.length > 0) {
        console.log(`  🔗 Found ${secondaryLinks.length} secondary links, fetching context...`);
        
        for (let i = 0; i < secondaryLinks.length; i++) {
          const secUrl = secondaryLinks[i];
          
          try {
            const secHtml = await fetchUrl(secUrl, 8000);
            const secText = extractMainContent(secHtml);
            const secCleaned = secText.slice(0, 1500).trim(); // Smaller chunk for secondary
            
            if (secCleaned.length > 300) {
              finalText += '\n\n[SECONDARY SOURCE]\n' + secCleaned;
              console.log(`  🔗 Added secondary content from: ${secUrl.slice(0, 50)}...`);
            }
          } catch (err) {
            // Silently skip if secondary fetch fails
            continue;
          }
        }
      }
    }

    // Trim to max chars again (now includes secondary content)
    const result = finalText.slice(0, MAX_ARTICLE_CHARS).trim();
    
    return { url: resolvedUrl, text: result };
  } catch (err) {
    console.log(`  ⚠️ Error fetching ${url.slice(0, 60)}... (${err.message})`);
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
