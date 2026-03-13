/**
 * Web Crawler for Official AI Framework Websites
 * Crawls OpenClaw, CrewAI, Dify, and other agentic AI framework websites
 * Extracts blog posts, tutorials, news, and documentation
 */

const { fetchUrl } = require('./fetch');

const CRAWL_TARGETS = {
  dify: {
    name: 'Dify',
    baseUrl: 'https://dify.ai',
    newsUrl: 'https://dify.ai/blog',
    tier: 1,
    type: 'official',
  },
  langchain: {
    name: 'LangChain',
    baseUrl: 'https://langchain.com',
    newsUrl: 'https://blog.langchain.dev',
    tier: 1,
    type: 'official',
  },
  n8n: {
    name: 'n8n',
    baseUrl: 'https://n8n.io',
    newsUrl: 'https://n8n.io/blog',
    tier: 1,
    type: 'official',
  },
  crewai: {
    name: 'CrewAI',
    baseUrl: 'https://crewai.com',
    newsUrl: 'https://docs.crewai.com/blog',
    tier: 1,
    type: 'official',
  },
  openclaw: {
    name: 'OpenClaw',
    baseUrl: 'https://github.com/openclaw/openclaw',
    newsUrl: 'https://github.com/openclaw/openclaw/releases',
    tier: 1,
    type: 'official',
  },
};

/**
 * Extract links and titles from HTML
 */
function extractLinksFromHtml(html, baseUrl) {
  const items = [];
  
  // Decode HTML entities
  const decode = (str) => {
    const entities = {
      '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"', '&apos;': "'",
      '&#39;': "'", '&#47;': '/', '&nbsp;': ' ',
    };
    return str.replace(/&[a-z]+;/gi, (match) => entities[match] || match);
  };
  
  const seen = new Set();
  
  // Strategy 1: Look specifically for blog/news article patterns
  const articlePatterns = [
    // Blog post links with dates
    /<a[^>]*href=["']([^"']*blog[^"']*)["'][^>]*>([^<]+)<\/a>/gi,
    // News/post links
    /<a[^>]*href=["']([^"']*(?:post|article|story|news)[^"']*)["'][^>]*>([^<]+)<\/a>/gi,
    // Release notes
    /<a[^>]*href=["']([^"']*(?:release|changelog|update)[^"']*)["'][^>]*>([^<]+)<\/a>/gi,
  ];
  
  // Strategy 2: Generic article links (with good title length)
  const genericPattern = /<a[^>]*href=["']([^"']+)["'][^>]*>([^<]{20,150})<\/a>/gi;
  
  // Try specific patterns first
  for (const pattern of articlePatterns) {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      const url = decode(match[1]);
      const title = decode(match[2]).replace(/<[^>]+>/g, '').trim();
      
      // Filter out nav/menu items
      if (title.length > 5 && !url.startsWith('#') && !/^(nav|menu|home|about|contact)/i.test(title)) {
        if (!seen.has(url)) {
          seen.add(url);
          items.push({
            title: title.slice(0, 200),
            url: url.startsWith('http') ? url : new URL(url, baseUrl).href,
            pubDate: null,
          });
        }
      }
    }
  }
  
  // If still need more items, try generic pattern
  if (items.length < 5) {
    let match;
    while ((match = genericPattern.exec(html)) !== null) {
      const url = decode(match[1]);
      const title = decode(match[2]).replace(/<[^>]+>/g, '').trim();
      
      // Better filtering for generic links
      if (title.length > 10 && !url.startsWith('#') && !seen.has(url)) {
        // Skip common navigation
        if (!/^(nav|menu|home|about|contact|signin|login|sign up|subscribe|follow|share)/i.test(title)) {
          seen.add(url);
          items.push({
            title,
            url: url.startsWith('http') ? url : new URL(url, baseUrl).href,
            pubDate: null,
          });
        }
      }
    }
  }
  
  return items.slice(0, 25);
}

/**
 * Crawl a website for news/blog content
 */
async function crawlWebsite(target) {
  try {
    const html = await fetchUrl(target.newsUrl, 10000);
    if (!html || html.length < 100) {
      console.log(`   ⚠️  ${target.name}: Empty response (${html ? html.length : 0} bytes)`);
      return [];
    }
    
    const links = extractLinksFromHtml(html, target.newsUrl);
    
    if (links.length === 0) {
      console.log(`   ⏭️  ${target.name}: No articles found on ${target.newsUrl}`);
      return [];
    }
    
    // Convert to standard format, capped at 25 items per source
    const items = links.slice(0, 25).map((link, idx) => ({
      title: link.title,
      text: `${link.title}`,
      url: link.url,
      source: target.name,
      sourceTier: target.tier,
      pubDate: link.pubDate,
      type: 'framework-news',
    }));
    
    console.log(`   ✅ ${target.name}: ${items.length} items`);
    return items;
  } catch (err) {
    console.log(`   ⚠️  ${target.name}: ${err.message}`);
    return [];
  }
}

/**
 * Fetch from all official framework websites
 */
async function fetchWebCrawlerNews() {
  console.log('\n🕷️  Crawling official framework websites...');
  
  const allItems = [];
  const targets = Object.values(CRAWL_TARGETS);

  // Fetch all sites in parallel
  const results = await Promise.all(
    targets.map(target => crawlWebsite(target))
  );

  for (const items of results) {
    allItems.push(...items);
  }

  // Dedup by URL
  const uniqueByUrl = new Map();
  for (const item of allItems) {
    if (item.url && !uniqueByUrl.has(item.url)) {
      uniqueByUrl.set(item.url, item);
    }
  }

  const dedupedItems = Array.from(uniqueByUrl.values());
  console.log(`   📊 Total: ${dedupedItems.length} items from official websites`);
  
  return dedupedItems;
}

module.exports = { fetchWebCrawlerNews };
