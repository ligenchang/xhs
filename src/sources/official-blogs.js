/**
 * Official AI News Sources Crawler
 * Fetches from official blogs and sources: OpenAI, Google AI, Meta AI, DeepMind, Anthropic, etc.
 */

const https = require('https');

// Simplified official sources - only reliable RSS feeds
const OFFICIAL_SOURCES = {
  google_ai: {
    rss: 'https://feeds.blog.google/feeds/posts/default/-/google-ai/',
    tier: 1,
    name: 'Google AI Blog'
  },
  anthropic: {
    rss: 'https://www.anthropic.com/feed.xml',
    tier: 1,
    name: 'Anthropic'
  },
  huggingface: {
    rss: 'https://huggingface.co/feed.xml',
    tier: 1,
    name: 'Hugging Face'
  }
};

/**
 * Simple XML tag extractor for RSS
 */
function extractXmlTag(xml, tag) {
  const regex = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const match = xml.match(regex);
  return match ? match[1].trim().replace(/<[^>]+>/g, '').slice(0, 500) : '';
}

/**
 * Parse RSS/Atom feed manually (improved regex approach)
 */
function parseRssFeed(xml) {
  const items = [];
  
  // Decode HTML entities (basic)
  const decode = (str) => {
    const entities = {
      '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"', '&apos;': "'",
      '&#39;': "'", '&#47;': '/'
    };
    return str.replace(/&[a-z]+;/gi, (match) => entities[match] || match);
  };
  
  // Try to find item tags (RSS) or entry tags (Atom)
  const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  const entryRegex = /<entry[^>]*>([\s\S]*?)<\/entry>/gi;
  
  let match;
  let regex = itemRegex;
  
  // Try items first (RSS)
  while ((match = regex.exec(xml)) !== null) {
    const itemXml = match[1];
    const title = extractXmlTag(itemXml, 'title');
    let link = extractXmlTag(itemXml, 'link');
    const description = extractXmlTag(itemXml, 'description') || extractXmlTag(itemXml, 'content:encoded');
    const pubDate = extractXmlTag(itemXml, 'pubDate') || extractXmlTag(itemXml, 'updated');
    
    // For RSS, link might be an attribute
    if (!link) {
      const linkMatch = itemXml.match(/<link[^>]*href=['"]?([^'">\s]+)/i);
      link = linkMatch ? linkMatch[1] : '';
    }
    
    if (title && description) {
      items.push({
        title: decode(title),
        link: decode(link),
        description: decode(description),
        pubDate: decode(pubDate)
      });
    }
  }
  
  // If no items found, try entries (Atom)
  if (items.length === 0) {
    regex = entryRegex;
    while ((match = regex.exec(xml)) !== null) {
      const entryXml = match[1];
      const title = extractXmlTag(entryXml, 'title');
      const linkMatch = entryXml.match(/href=['"]?([^'">\s]+)/);
      const link = linkMatch ? linkMatch[1] : '';
      const summary = extractXmlTag(entryXml, 'summary') || extractXmlTag(entryXml, 'content');
      const published = extractXmlTag(entryXml, 'published') || extractXmlTag(entryXml, 'updated');
      
      if (title && summary) {
        items.push({
          title: decode(title),
          link: decode(link),
          description: decode(summary),
          pubDate: decode(published)
        });
      }
    }
  }
  
  return items;
}

/**
 * Fetch RSS feed and extract items
 */
function fetchAndParseRss(url, sourceName) {
  return new Promise((resolve) => {
    https.get(url, { timeout: 8000 }, (res) => {
      let data = '';
      
      res.on('data', chunk => (data += chunk.toString()));
      res.on('end', () => {
        try {
          if (!data || data.length < 50) {
            console.log(`   ⚠️  ${sourceName}: Empty response (${data ? data.length : 0} bytes)`);
            resolve(null);
            return;
          }
          const items = parseRssFeed(data);
          if (items.length === 0) {
            console.log(`   ⚠️  ${sourceName}: No items parsed from RSS`);
          }
          resolve(items.length > 0 ? items : null);
        } catch (err) {
          console.log(`   ⚠️  ${sourceName}: Parse error: ${err.message}`);
          resolve(null);
        }
      });
    }).on('error', (err) => {
      console.log(`   ⚠️  ${sourceName}: Fetch error: ${err.message}`);
      resolve(null);
    }).on('timeout', function() {
      this.destroy();
      console.log(`   ⚠️  ${sourceName}: Request timeout`);
      resolve(null);
    });
  });
}

/**
 * Convert parsed RSS items to standard format
 */
function convertToStandardFormat(items, source) {
  if (!items || items.length === 0) return [];
  
  return items.slice(0, 15).map(item => {
    // Create text from title and description
    const text = (item.title + ' ' + (item.description || '')).trim();
    
    return {
      title: item.title,
      text: text.slice(0, 1000),
      url: item.link || '',
      source: source.name,
      sourceTier: source.tier,
      pubDate: item.pubDate ? new Date(item.pubDate) : null
    };
  }).filter(item => item.text.length > 30); // Very lenient minimum
}

/**
 * Fetch from all official AI sources
 */
async function fetchOfficialBlogs() {
  console.log('\n📰 Fetching official AI news sources...');
  
  const allItems = [];
  const sources = Object.values(OFFICIAL_SOURCES);

  // Fetch all RSS feeds in parallel
  const results = await Promise.all(
    sources.map(async (source) => {
      try {
        const rawItems = await fetchAndParseRss(source.rss, source.name);
        if (rawItems && rawItems.length > 0) {
          const converted = convertToStandardFormat(rawItems, source);
          console.log(`   ✅ ${source.name}: ${converted.length} articles`);
          return converted;
        } else {
          console.log(`   ⏭️  Skipped: ${source.name} (no articles)`);
          return [];
        }
      } catch (err) {
        console.log(`   ⚠️  Error: ${source.name} - ${err.message}`);
        return [];
      }
    })
  );

  // Collect all articles
  for (const items of results) {
    allItems.push(...items);
  }

  // Dedup by URL
  const uniqueByUrl = new Map();
  for (const item of allItems) {
    if (item.url && !uniqueByUrl.has(item.url)) {
      uniqueByUrl.set(item.url, item);
    } else if (!item.url && item.title && !uniqueByUrl.has(item.title)) {
      uniqueByUrl.set(item.title, item);
    }
  }

  const dedupedItems = Array.from(uniqueByUrl.values());
  console.log(`   📊 Total: ${dedupedItems.length} unique articles from official sources`);
  
  return dedupedItems;
}

module.exports = { fetchOfficialBlogs };
