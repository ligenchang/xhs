/**
 * Persistent store for tracking published news hashes.
 * Prevents republishing the same story.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');

const PUBLISHED_FILE = path.resolve(config.publishedFile);
const MAX_HASHES = 500;

function hashText(text) {
  const normalized = text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
  return crypto.createHash('md5').update(normalized).digest('hex');
}

function load() {
  try {
    if (fs.existsSync(PUBLISHED_FILE)) {
      const data = JSON.parse(fs.readFileSync(PUBLISHED_FILE, 'utf-8'));
      return new Set(data.published || []);
    }
  } catch (_) {}
  return new Set();
}

function save(hash) {
  try {
    fs.mkdirSync(path.dirname(PUBLISHED_FILE), { recursive: true });
    const raw = fs.existsSync(PUBLISHED_FILE)
      ? JSON.parse(fs.readFileSync(PUBLISHED_FILE, 'utf-8'))
      : { published: [] };

    if (!raw.published.includes(hash)) {
      raw.published.push(hash);
      raw.lastUpdate = new Date().toISOString();
      if (raw.published.length > MAX_HASHES) {
        raw.published = raw.published.slice(-MAX_HASHES);
      }
      fs.writeFileSync(PUBLISHED_FILE, JSON.stringify(raw, null, 2));
    }
  } catch (err) {
    console.warn(`⚠️ 无法保存已发布记录: ${err.message}`);
  }
}

function reset() {
  fs.mkdirSync(path.dirname(PUBLISHED_FILE), { recursive: true });
  fs.writeFileSync(PUBLISHED_FILE, JSON.stringify({ published: [], lastUpdate: null }, null, 2));
  console.log('✅ 已发布列表已重置');
}

function stats() {
  try {
    if (fs.existsSync(PUBLISHED_FILE)) {
      const data = JSON.parse(fs.readFileSync(PUBLISHED_FILE, 'utf-8'));
      console.log(`\n📊 已发布: ${data.published.length} 条`);
      if (data.lastUpdate) {
        console.log(`  最后更新: ${new Date(data.lastUpdate).toLocaleString('zh-CN')}`);
      }
      return;
    }
  } catch (_) {}
  console.log('\n📊 暂无发布记录');
}

module.exports = { hashText, load, save, reset, stats };
