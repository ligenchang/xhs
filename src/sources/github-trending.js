/**
 * GitHub Trending Repositories Crawler
 * Fetches trending AI/ML repositories from GitHub's trending page
 */

const { fetchUrl } = require('./fetch');

/**
 * Parse GitHub trending page for repositories
 */
function parseGitHubTrending(html) {
  const items = [];
  
  // GitHub trending uses article with class "Box-row" for each repo
  // Look for repository links more flexibly
  const repoPattern = /href="(\/[^\/][^"]*?)"[^>]*>([^<]+)<\/a>[\s\S]*?(?:<p|<span)[\s\S]*?(?:Star|star)/i;
  
  // More robust: find all repo links in trending format
  const linkMatches = html.matchAll(/<article[^>]*>([\s\S]*?)<\/article>/g);
  
  for (const match of linkMatches) {
    const article = match[1];
    
    // Find repo URL (typically /username/repo pattern)
    const urlMatch = article.match(/href="(\/[a-zA-Z0-9\-_]+\/[a-zA-Z0-9\-_.]+)"/);
    if (!urlMatch) continue;
    
    const repoPath = urlMatch[1];
    
    // Find repo name (after last /)
    const repoParts = repoPath.split('/').filter(p => p);
    if (repoParts.length < 2) continue;
    const repoName = repoParts[repoParts.length - 1];
    const owner = repoParts[repoParts.length - 2];
    
    // Find description - it's usually in a paragraph after the link
    let description = '';
    const descMatch = article.match(/<p[^>]*class="col-9[^"]*"[^>]*>([^<]+)<\/p>/);
    if (descMatch) {
      description = descMatch[1].trim();
    }
    
    // Find stars
    let stars = '0';
    const starsMatch = article.match(/class="d-inline-block[^"]*">[\s\S]*?<svg[\s\S]*?<\/svg>\s*([0-9,]+)/);
    if (starsMatch) {
      stars = starsMatch[1];
    }
    
    if (repoName) {
      items.push({
        title: `${owner}/${repoName}${stars ? ` (${stars}⭐)` : ''}`,
        description: description || 'Trending AI repository',
        url: `https://github.com${repoPath}`,
        stars: parseInt(stars.replace(/,/g, '') || 0),
      });
    }
  }
  
  return items;
}

/**
 * Fetch GitHub trending repositories
 */
async function fetchGitHubTrending() {
  try {
    // Fetch trending page for today
    const html = await fetchUrl('https://github.com/trending?spoken_language_code=&since=daily', 12000);
    
    if (!html || html.length < 500) {
      console.log(`   ⚠️  GitHub Trending: Empty response`);
      return [];
    }
    
    const repos = parseGitHubTrending(html);
    
    if (repos.length === 0) {
      console.log(`   ⏭️  GitHub Trending: No repositories found`);
      return [];
    }
    
    // Convert to standard format, take top 15
    const items = repos.slice(0, 15).map(repo => ({
      title: repo.title,
      text: `Repository: ${repo.title}\n${repo.description}`,
      url: repo.url,
      source: 'GitHub Trending',
      sourceTier: 2,
      pubDate: null,
      type: 'repository',
    }));
    
    console.log(`   ✅ GitHub Trending: ${items.length} repositories`);
    return items;
  } catch (err) {
    console.log(`   ⚠️  GitHub Trending: ${err.message}`);
    return [];
  }
}

module.exports = { fetchGitHubTrending };
