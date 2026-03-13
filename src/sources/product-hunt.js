/**
 * Product Hunt — Daily AI product launches via GraphQL API (no auth required).
 *
 * Returns: Array<{ text, title, url, pubDate, source, sourceTier }>
 */

const https = require('https');

function graphqlRequest(query) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query });
    const options = {
      hostname: 'api.producthunt.com',
      path: '/v2/api/graphql',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Accept': 'application/json',
        // Public access token — read-only, no account required
        'Authorization': 'Bearer ' + '6ySXDMPAQNQDDMBHPSgesg',
        'User-Agent': 'Mozilla/5.0',
      },
    };

    const req = https.request(options, (res) => {
      clearTimeout(timer);
      let data = '';
      res.on('data', (d) => (data += d));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    const timer = setTimeout(() => { req.destroy(); reject(new Error('timeout')); }, 10000);
    req.write(body);
    req.end();
  });
}

async function fetchProductHunt() {
  console.log('\n🚀 Fetching Product Hunt AI launches...');
  try {
    const query = `{
      posts(order: VOTES, topic: "artificial-intelligence", first: 30) {
        edges {
          node {
            name
            tagline
            description
            url
            votesCount
            createdAt
          }
        }
      }
    }`;

    const data = await graphqlRequest(query);
    const edges = data?.data?.posts?.edges;
    if (!Array.isArray(edges)) {
      console.log(`  ✓ Product Hunt: 0 items (unexpected response)`);
      return [];
    }

    const products = edges
      .map((e) => e.node)
      .filter((p) => p && p.name && (p.votesCount || 0) >= 5)
      .map((p) => ({
        text:       `[Product Hunt] ${p.name}: ${p.tagline || ''}. ${(p.description || '').slice(0, 200)}`,
        title:      `${p.name}: ${p.tagline || ''}`,
        url:        p.url || `https://www.producthunt.com`,
        pubDate:    p.createdAt ? new Date(p.createdAt) : new Date(),
        source:     'Product Hunt',
        sourceTier: 2,
      }));

    console.log(`  ✓ Product Hunt: ${products.length} AI products`);
    return products;
  } catch (err) {
    console.log(`  ✓ Product Hunt: 0 items (${err.message})`);
    return [];
  }
}

module.exports = { fetchProductHunt };
