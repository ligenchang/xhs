/**
 * Central config — reads from environment variables.
 * All other modules import from here; no module reads process.env directly.
 */

require('dotenv').config();

function requireEnv(name) {
  const val = process.env[name];
  if (!val) {
    console.error(`❌ 错误: 未设置 ${name} 环境变量`);
    process.exit(1);
  }
  return val;
}

const config = {
  ai: {
    apiKey: requireEnv('NVIDIA_API_KEY'),
    baseURL: 'https://integrate.api.nvidia.com/v1',
    model: 'nvidia/nemotron-3-nano-30b-a3b',
  },
  browser: {
    headless: false,
    slowMo: 500,
    timeout: 30000,
  },
  twitter: {
    authToken: process.env.AUTH_TOKEN || '',
    ct0: process.env.CT0 || '',
  },
  cookiesFile: './xhs_cookies.json',
  publishedFile: './data/published_news.json',
  scheduler: {
    minIntervalMs: 10 * 60 * 1000,
    maxIntervalMs: 25 * 60 * 1000,
  },
};

module.exports = config;
