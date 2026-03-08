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
 *   node index.js schedule   # run on a random interval loop
 *   node index.js test-schedule # schedule with 10-20 second intervals (testing)
 *   node index.js stats      # show published count
 *   node index.js reset      # clear published history
 *   node index.js --help
 */

const command = process.argv[2] || 'publish';
const urls = command === 'url' ? process.argv.slice(3) : [];

if (command === '--help' || command === '-h' || command === 'help') {
  console.log(`
🚀 XHS Auto Publisher

Commands:
  publish        Publish one post (default)
  now            Publish immediately (testing)
  url <URL>      Publish from a custom URL or multiple URLs (supports HTML & PDF)
  schedule       Auto-publish every 20–40 minutes
  test-schedule  Auto-publish every 10–20 seconds (for testing)
  stats          Show published post count
  reset          Clear published history

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
