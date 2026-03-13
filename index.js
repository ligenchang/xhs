#!/usr/bin/env node

/**
 * XHS Auto Publisher
 *
 * Usage:
 *   node index.js            # publish one post (default)
 *   node index.js publish    # same as above
 *   node index.js now        # publish immediately (testing)
 *   node index.js url <URL>  # publish from a custom URL
 *   node index.js url <URL1> <URL2> <URL3>  # publish from multiple URLs for more context
 *   node index.js topic <keyword>  # publish focusing on a specific topic
 *   node index.js schedule   # run on a random interval loop
 *   node index.js test-schedule # schedule with 10-20 second intervals (testing)
 *   node index.js stats      # show published count
 *   node index.js reset      # clear published history
 *   node index.js --help
 */

const command = process.argv[2] || 'publish';
const urls = command === 'url' ? process.argv.slice(3) : [];

// topic <keyword> — focus on a specific topic
if (command === 'topic') {
  const keyword = process.argv.slice(3).join(' ');
  if (!keyword) {
    console.error('Usage: node index.js topic <keyword>');
    console.error('Example: node index.js topic "Claude 4"');
    process.exit(1);
  }
  process.env.FOCUS_TOPIC = keyword;
  console.log(`🎯 Topic focus: "${keyword}"`);
}

// schedule topic <keyword> — run scheduler focused on a topic
if (command === 'schedule' && process.argv[3] === 'topic') {
  const keyword = process.argv.slice(4).join(' ');
  if (!keyword) {
    console.error('Usage: node index.js schedule topic <keyword>');
    console.error('Example: node index.js schedule topic "Claude 4"');
    process.exit(1);
  }
  process.env.FOCUS_TOPIC = keyword;
  console.log(`🎯 Scheduler topic focus: "${keyword}"`);
}
if (command === '--help' || command === '-h' || command === 'help') {
  console.log(`
🚀 XHS Auto Publisher

Commands:
  publish        Publish one post (default)
  now            Publish immediately (testing)
  url <URL>      Publish from a custom URL or multiple URLs (supports HTML & PDF)
  schedule       Auto-publish every 20–40 minutes
  schedule topic <kw>  Schedule with topic focus (e.g. schedule topic LLM)
  test-schedule  Auto-publish every 10–20 seconds (for testing)
  topic <kw>     Publish once focusing only on articles matching keyword
  stats          Show published post count
  reset          Clear published history

Examples:
  # Focus on a specific topic (publish once):
  node index.js topic "Claude 4"
  node index.js topic "Diffusion Model"

  # Run scheduler focused on a topic:
  node index.js schedule topic LLM
  node index.js schedule topic "RAG systems"

  # Or via env var (works with any command):
  FOCUS_TOPIC="LangChain" node index.js schedule

Examples:
  # Single URL:
  node index.js url "https://deepmind.google/blog/discovering-new-solutions..."

  # PDF document (requires pdf-parse):
  node index.js url https://arxiv.org/pdf/2509.14185

  # Multiple URLs for more context:
  node index.js url https://example1.com/article https://arxiv.org/pdf/2509.14185 https://example3.com

Environment variables:
  NVIDIA_API_KEY   Required — AI API key
  AUTH_TOKEN       Optional — Twitter auth token
  CT0              Optional — Twitter CT0 token

📄 PDF Support:
  PDF extraction works with or without pdf-parse library.
  
  ⚠️  RECOMMENDED: Install pdf-parse for better PDF text extraction:
    npm install pdf-parse
  
  Without pdf-parse:
  - Basic fallback extraction may have limited quality
  - Complex PDFs with compressed content may not extract well
  - Recommend installing pdf-parse for reliable PDF parsing
  
  With pdf-parse:
  ✅ High quality text extraction from any PDF
  ✅ Handles compressed streams, images, complex layouts
  ✅ Supports scanned PDFs with OCR-like extraction
`);
  process.exit(0);
}

// Config validates env vars on load; this will exit if NVIDIA_API_KEY is missing.
require('./src/config');

async function main() {
  switch (command) {
    case 'publish':
    case 'now':
    case 'topic':
      await require('./src/publish').publish();
      break;

    case 'url':
      if (!urls || urls.length === 0) {
        console.error('❌ URL argument is required. Usage: node index.js url <URL> [URL2] [URL3]...');
        process.exit(1);
      }
      await require('./src/publish-from-url').publishFromUrl(urls);
      break;

    case 'schedule':
      await require('./src/scheduler').schedule();
      break;

    case 'test-schedule':
      // Override config for testing — shorter intervals
      require('./src/config').scheduler.minIntervalMs = 10 * 1000;
      require('./src/config').scheduler.maxIntervalMs = 20 * 1000;
      await require('./src/scheduler').schedule();
      break;

    case 'stats':
      require('./src/store').stats();
      break;

    case 'reset':
      require('./src/store').reset();
      break;

    default:
      console.error(`❌ 未知命令: ${command}。运行 node index.js --help 查看帮助。`);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error('❌ 执行失败:', err.message);
  process.exit(1);
});
