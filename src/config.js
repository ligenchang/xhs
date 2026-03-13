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
    model: 'nvidia/nemotron-3-super-120b-a12b',
    temperature: 1,
    topP: 0.95,
    maxTokens: 16384,
    reasoningBudget: 16384,
    enableThinking: false,
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
    maxIntervalMs: 30 * 60 * 1000,
  },
  // Optional topic focus: only fetch/score items matching this keyword.
  // Set via FOCUS_TOPIC env var or `node index.js topic <keyword>`.
  focusTopic: process.env.FOCUS_TOPIC || '',
};

module.exports = config;
