/**
 * Topic Search — targeted multi-source keyword search.
 *
 * Called only when focusTopic is set. Queries APIs that support full-text
 * search so filtered runs still have enough candidates.
 *
 * Sources (all free, no auth required):
 *   - HN Algolia     — keyword search across all HN stories
 *   - Reddit search  — cross-subreddit search
 *   - GitHub repos   — repositories matching the keyword
 *   - arXiv query    — papers matching the keyword
 */

const { fetchUrl } = require('./fetch');

async function fetchHNAlgolia(topic) {
  const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(topic)}&tags=story&hitsPerPage=30`;
  const raw = await fetchUrl(url, 8000);
  const data = JSON.parse(raw);
  if (!data?.hits) return [];

  return data.hits
    .filter((h) => h.title && (h.points || 0) >= 5)
    .map((h) => ({
      text:       `[HN] ${h.title}.`,
      title:      h.title,
      url:        h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
      pubDate:    h.created_at ? new Date(h.created_at) : null,
      hnScore:    h.points || 0,
      source:     'Hacker News (search)',
      sourceTier: 2,
    }));
}

async function fetchRedditSearch(topic) {
  const url = `https://www.reddit.com/search.json?q=${encodeURIComponent(topic)}&sort=relevance&t=month&limit=25`;
  const raw = await fetchUrl(url, 8000);
  const data = JSON.parse(raw);
  if (!data?.data?.children) return [];

  return data.data.children
    .filter((c) => c.data && (c.data.score || 0) >= 5 && !c.data.is_self && !c.data.stickied)
    .map((c) => {
      const p = c.data;
      return {
        text:       `[Reddit r/${p.subreddit}] ${p.title}. (${p.score} upvotes, ${p.num_comments} comments)`,
        title:      p.title,
        url:        p.url,
        pubDate:    new Date(p.created_utc * 1000),
        source:     `Reddit (r/${p.subreddit})`,
        sourceTier: 2,
      };
    });
}

async function fetchGitHubSearch(topic) {
  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(topic)}&sort=updated&per_page=20`;
  const raw = await fetchUrl(url, 8000);
  const data = JSON.parse(raw);
  if (!data?.items) return [];

  return data.items
    .filter((r) => (r.stargazers_count || 0) >= 5 && r.description)
    .map((r) => ({
      text:       `[GitHub] ${r.full_name}: ${r.description}. (${r.stargazers_count} stars, updated ${(r.pushed_at || '').slice(0, 10)})`,
      title:      `${r.full_name}: ${r.description}`,
      url:        r.html_url,
      pubDate:    r.pushed_at ? new Date(r.pushed_at) : null,
      source:     'GitHub',
      sourceTier: 2,
    }));
}

async function fetchArxivSearch(topic) {
  const query = encodeURIComponent(`all:${topic}`);
  const url   = `https://export.arxiv.org/api/query?search_query=${query}&max_results=15&sortBy=submittedDate&sortOrder=descending`;
  const xml   = await fetchUrl(url, 10000);

  const items  = [];
  const entryRe = /<entry[\s\S]*?<\/entry>/gi;
  const titleRe = /<title[^>]*>([\s\S]*?)<\/title>/i;
  const summRe  = /<summary[^>]*>([\s\S]*?)<\/summary>/i;
  const linkRe  = /<id[^>]*>(https?:\/\/[^<]+)<\/id>/i;
  const dateRe  = /<published[^>]*>([\s\S]*?)<\/published>/i;

  let m;
  while ((m = entryRe.exec(xml)) !== null) {
    const block   = m[0];
    const title   = (titleRe.exec(block)?.[1] || '').replace(/<[^>]+>/g, '').trim();
    const summary = (summRe.exec(block)?.[1]  || '').replace(/<[^>]+>/g, '').trim().slice(0, 800);
    const link    = linkRe.exec(block)?.[1]?.trim() || null;
    const date    = dateRe.exec(block)?.[1];
    if (!title || !summary) continue;

    items.push({
      text:       `[arXiv] ${title}. ${summary}`,
      title,
      url:        link || '',
      pubDate:    date ? new Date(date.trim()) : null,
      source:     'arXiv (search)',
      sourceTier: 1,
    });
  }
  return items;
}

async function fetchGoogleNews(topic) {
  // Google News RSS — free, no auth, works for any keyword
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(topic)}&hl=en-US&gl=US&ceid=US:en`;
  const xml = await fetchUrl(url, 10000);

  const items  = [];
  const itemRe = /<item[\s\S]*?<\/item>/gi;
  const titleRe = /<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i;
  const linkRe  = /<link[^>]*>([^<]+)<\/link>/i;
  const dateRe  = /<pubDate[^>]*>([^<]+)<\/pubDate>/i;
  const srcRe   = /<source[^>]*>([^<]*)<\/source>/i;

  let m;
  while ((m = itemRe.exec(xml)) !== null) {
    const block = m[0];
    const title = (titleRe.exec(block)?.[1] || '').replace(/<[^>]+>/g, '').trim();
    const link  = (linkRe.exec(block)?.[1]  || '').trim();
    const date  = dateRe.exec(block)?.[1];
    const src   = (srcRe.exec(block)?.[1]   || 'Google News').trim();
    if (!title || title.length < 10) continue;

    items.push({
      text:       `[${src}] ${title}`,
      title,
      url:        link || '',
      pubDate:    date ? new Date(date) : null,
      source:     `Google News (${src})`,
      sourceTier: 2,
    });
  }
  return items;
}

async function fetchTopicSearch(topic) {
  console.log(`\n🔍 Topic search: "${topic}" (HN Algolia + Reddit + GitHub + arXiv + Google News)...`);

  const [hn, reddit, github, arxiv, gnews] = await Promise.allSettled([
    fetchHNAlgolia(topic),
    fetchRedditSearch(topic),
    fetchGitHubSearch(topic),
    fetchArxivSearch(topic),
    fetchGoogleNews(topic),
  ]);

  const hnItems     = hn.status     === 'fulfilled' ? hn.value     : [];
  const redditItems = reddit.status === 'fulfilled' ? reddit.value : [];
  const githubItems = github.status === 'fulfilled' ? github.value : [];
  const arxivItems  = arxiv.status  === 'fulfilled' ? arxiv.value  : [];
  const gnewsItems  = gnews.status  === 'fulfilled' ? gnews.value  : [];

  console.log(`  ✓ HN: ${hnItems.length}, Reddit: ${redditItems.length}, GitHub: ${githubItems.length}, arXiv: ${arxivItems.length}, Google News: ${gnewsItems.length}`);

  return [...hnItems, ...redditItems, ...githubItems, ...arxivItems, ...gnewsItems];
}

module.exports = { fetchTopicSearch };
