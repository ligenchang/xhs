/**
 * Reddit — AI/ML community discussions
 *
 * Fetches hot and top posts from AI/ML subreddits:
 * r/MachineLearning, r/LanguageModels, r/OpenAI, r/StableDiffusion, etc.
 *
 * Returns: Array<{ text, title, url, pubDate, score, source, sourceTier }>
 */

const { fetchUrl } = require('./fetch');

const SUBREDDITS = [
  'MachineLearning',
  'LanguageModels',
  'OpenAI',
  'LocalLLM',
  'Artificial',
  'learnmachinelearning',
  'StableDiffusion',
];

async function fetchReddit() {
  console.log('\n🤖 Fetching Reddit AI communities...');
  const posts = [];
  const seenUrls = new Set();

  await Promise.allSettled(
    SUBREDDITS.map(async (subreddit) => {
      try {
        // Reddit JSON API - fetch hot posts from last 24 hours
        const url = `https://www.reddit.com/r/${subreddit}/hot.json?limit=50`;
        const response = await fetchUrl(url, 8000);
        
        let data;
        try {
          data = JSON.parse(response);
        } catch (e) {
          return;
        }

        if (!data || !data.data || !Array.isArray(data.data.children)) return;

        data.data.children.forEach((child) => {
          const post = child.data;
          if (!post || !post.url || !post.title || post.score < 10) return;
          if (seenUrls.has(post.url)) return;

          // Skip self-posts and stickies
          if (post.is_self || post.stickied) return;

          seenUrls.add(post.url);
          posts.push({
            text: `[Reddit r/${subreddit}] ${post.title}. (${post.score} upvotes, ${post.num_comments} comments)`,
            title: post.title,
            url: post.url,
            pubDate: new Date(post.created_utc * 1000),
            score: post.score,
            comments: post.num_comments,
            source: `Reddit (r/${subreddit})`,
            sourceTier: 2,
          });
        });
      } catch (err) {
        // Silent fail for individual subreddits
      }
    })
  );

  console.log(`  ✓ Reddit: ${posts.length} AI posts`);
  return posts.slice(0, 25); // Cap at 25 items
}

module.exports = { fetchReddit };
