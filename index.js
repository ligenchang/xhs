#!/usr/bin/env node

/**
 * XHS Auto Publisher
 *
 * Usage:
 *   node index.js            # publish one post (default)
 *   node index.js publish    # same as above
 *   node index.js schedule   # run on a random interval loop
 *   node index.js stats      # show published count
 *   node index.js reset      # clear published history
 *   node index.js --help
 */

const command = process.argv[2] || 'publish';

if (command === '--help' || command === '-h' || command === 'help') {
  console.log(`
🚀 XHS Auto Publisher

Commands:
  publish    Publish one post (default)
  schedule   Auto-publish every 20–40 minutes
  stats      Show published post count
  reset      Clear published history

Environment variables:
  NVIDIA_API_KEY   Required — AI API key
  AUTH_TOKEN       Optional — Twitter auth token
  CT0              Optional — Twitter CT0 token
`);
  process.exit(0);
}

// Config validates env vars on load; this will exit if NVIDIA_API_KEY is missing.
require('./src/config');

async function main() {
  switch (command) {
    case 'publish':
      await require('./src/publish').publish();
      break;

    case 'schedule':
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
