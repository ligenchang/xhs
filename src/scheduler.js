/**
 * schedule: run publish() in an infinite loop with random intervals.
 */

const config = require('./config');
const { publish } = require('./publish');

function randomInterval() {
  const { minIntervalMs, maxIntervalMs } = config.scheduler;
  return Math.floor(Math.random() * (maxIntervalMs - minIntervalMs + 1) + minIntervalMs);
}

function formatMs(ms) {
  return `${Math.floor(ms / 60000)}分${Math.floor((ms % 60000) / 1000)}秒`;
}

async function schedule() {
  console.log('\n🚀 调度器已启动');
  console.log(`⏰ 每 ${formatMs(config.scheduler.minIntervalMs)}–${formatMs(config.scheduler.maxIntervalMs)} 随机发布一条\n`);

  while (true) {
    const wait = randomInterval();
    console.log(`⏳ 下次发布：${formatMs(wait)} 后...`);
    await new Promise((r) => setTimeout(r, wait));

    console.log('\n✅ 开始发布...');
    try {
      await publish();
      console.log('🎉 发布成功！\n');
    } catch (err) {
      if (err.message.startsWith('NEWS_QUALITY_TOO_LOW')) {
        console.warn(`⏭️  跳过：${err.message.replace('NEWS_QUALITY_TOO_LOW: ', '')}\n`);
      } else {
        console.error(`❌ 发布失败: ${err.message}`);
        console.log('⏳ 5 秒后重试...');
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  }
}

module.exports = { schedule };
