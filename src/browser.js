/**
 * Browser automation: logs into Xiaohongshu creator platform and publishes a post.
 */

const { chromium } = require('playwright');
const fs = require('fs');
const config = require('./config');

class XhsBrowser {
  constructor() {
    this.browser = null;
    this.context = null;
    this.page = null;
  }

  async init() {
    console.log('\n🚀 启动浏览器...');
    this.browser = await chromium.launch({
      headless: config.browser.headless,
      slowMo: config.browser.slowMo,
      args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
    });
    this.context = await this.browser.newContext({
      viewport: { width: 1440, height: 900 },
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      locale: 'zh-CN',
      timezoneId: 'Asia/Shanghai',
    });
    await this.context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });
    this.page = await this.context.newPage();
    this.page.setDefaultTimeout(config.browser.timeout);
  }

  async loadCookies() {
    if (fs.existsSync(config.cookiesFile)) {
      console.log('📂 加载 Cookie...');
      const cookies = JSON.parse(fs.readFileSync(config.cookiesFile, 'utf-8'));
      await this.context.addCookies(cookies);
    }
  }

  async saveCookies() {
    const cookies = await this.context.cookies();
    fs.writeFileSync(config.cookiesFile, JSON.stringify(cookies, null, 2));
    console.log('💾 Cookie 已保存');
  }

  async ensureLoggedIn() {
    await this.page.goto('https://creator.xiaohongshu.com', { waitUntil: 'domcontentloaded' });
    await this.page.waitForTimeout(3000);

    const loggedOut = this.page.url().includes('login') || this.page.url().includes('signin');
    if (loggedOut) {
      console.log('❌ 未登录，请扫码（最长等待 120 秒）...');
      await this.page.waitForFunction(
        () => !location.href.includes('login') && !location.href.includes('signin'),
        { timeout: 120000 }
      );
      await this.page.waitForTimeout(2000);
      console.log('✅ 登录成功');
      await this.saveCookies();
    } else {
      console.log('✅ 已登录');
    }
  }

  /**
   * Find and click any visible element matching labelText.
   * Falls back to a 15-second manual pause if not found.
   */
  async smartClick(labelText, timeoutMs = 8000) {
    console.log(`🔍 查找 "${labelText}"...`);
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const clicked = await this.page.evaluate((text) => {
        for (const el of document.querySelectorAll('a, button, span, div, li')) {
          if (el.children.length > 0 && el.tagName !== 'BUTTON' && el.tagName !== 'A') continue;
          const t = el.innerText?.trim();
          if (!t || !(t === text || t.includes(text))) continue;
          const rect = el.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0 || rect.top < 0) continue;
          const style = window.getComputedStyle(el);
          if (style.pointerEvents === 'none' || style.opacity === '0') continue;
          if (el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true') continue;
          el.click();
          return true;
        }
        return false;
      }, labelText);

      if (clicked) {
        console.log(`  ✅ 点击: "${labelText}"`);
        await this.page.waitForTimeout(1500);
        return true;
      }

      await this.page.waitForTimeout(500);
    }

    console.log(`  ⚠️ 未找到 "${labelText}"，等待 15 秒手动操作...`);
    await this.page.waitForTimeout(15000);
    return false;
  }

  async navigateToEditor() {
    console.log('\n📝 打开长文编辑器...');
    if (!this.page.url().includes('creator.xiaohongshu.com')) {
      await this.page.goto('https://creator.xiaohongshu.com', { waitUntil: 'domcontentloaded' });
      await this.page.waitForTimeout(3000);
    }
    await this.smartClick('发布笔记', 5000);
    await this.page.waitForTimeout(1200);
    await this.smartClick('写长文', 5000);
    await this.page.waitForTimeout(1200);

    const hasNew = await this.page.evaluate(() =>
      [...document.querySelectorAll('a, button, span, div')].some((el) => {
        const rect = el.getBoundingClientRect();
        return el.innerText?.trim() === '新的创作' && rect.width > 0 && rect.top >= 0;
      })
    );
    if (hasNew) await this.smartClick('新的创作', 5000);
    await this.page.waitForTimeout(3000);
  }

  async fillTitle(title) {
    if (!title) return;
    console.log('\n✏️ 填写标题...');
    const selectors = [
      'input[placeholder*="标题"]',
      'textarea[placeholder*="标题"]',
      '[contenteditable][placeholder*="标题"]',
    ];
    for (const target of [this.page, ...this.page.frames()]) {
      for (const sel of selectors) {
        const el = await target.$(sel).catch(() => null);
        if (!el) continue;
        await el.click();
        await target.keyboard.press('Control+A');
        await el.fill(title).catch(() => target.keyboard.type(title));
        console.log('  ✅ 标题已填写');
        return;
      }
    }
    console.log('  ⚠️ 未找到标题框，等待 10 秒手动填写...');
    await this.page.waitForTimeout(10000);
  }

  async fillContent(content) {
    console.log('\n✏️ 填写正文...');
    const selectors = ['.ProseMirror', '[contenteditable="true"][class*="editor"]', '[contenteditable="true"]'];
    const targets = [this.page, ...this.page.frames().filter((f) => f !== this.page.mainFrame())];

    for (const target of targets) {
      for (const sel of selectors) {
        const elements = await target.$$(sel).catch(() => []);
        if (!elements.length) continue;

        // Pick the largest element (most likely the main editor)
        let bestEl = null, bestArea = 0;
        for (const el of elements) {
          const box = await el.boundingBox().catch(() => null);
          if (box && box.width * box.height > bestArea) { bestArea = box.width * box.height; bestEl = el; }
        }
        if (!bestEl) continue;

        await bestEl.click();
        await target.waitForTimeout(300);
        await target.keyboard.press('Control+A');
        await target.keyboard.press('Delete');
        await target.waitForTimeout(200);

        for (let i = 0; i < content.split('\n').length; i++) {
          const line = content.split('\n')[i];
          if (line) await target.keyboard.type(line, { delay: 15 });
          if (i < content.split('\n').length - 1) await target.keyboard.press('Enter');
        }

        console.log('  ✅ 正文已填写');
        return;
      }
    }
    console.log('  ⚠️ 未找到编辑器，等待 10 秒手动填写...');
    await this.page.waitForTimeout(10000);
  }

  async publish() {
    console.log('\n🚀 发布中...');
    await this.page.waitForTimeout(3500);
    await this.smartClick('下一步', 5000);
    await this.page.waitForTimeout(2000);

    const deadline = Date.now() + 45000;
    let clicked = false;

    while (Date.now() < deadline && !clicked) {
      // Try selector first
      const btn = await this.page.$('button:has-text("发布")').catch(() => null);
      if (btn) {
        try {
          await btn.scrollIntoViewIfNeeded();
          await this.page.waitForTimeout(500);
          await btn.click({ timeout: 3000 });
          clicked = true;
          break;
        } catch (_) {}
      }

      // Fallback: evaluate click
      const result = await this.page.evaluate(() => {
        for (const btn of document.querySelectorAll('button')) {
          const text = btn.textContent?.trim();
          if (text !== '发布' && !text?.includes('发布')) continue;
          const rect = btn.getBoundingClientRect();
          const style = window.getComputedStyle(btn);
          if (rect.width > 0 && rect.height > 0 && rect.top >= 0 &&
              style.pointerEvents !== 'none' && !btn.hasAttribute('disabled')) {
            btn.scrollIntoView({ block: 'center' });
            btn.click();
            return true;
          }
        }
        return false;
      });
      if (result) { clicked = true; break; }

      await this.page.waitForTimeout(800);
    }

    if (!clicked) {
      console.log('  ❌ 无法找到发布按钮，请手动点击（等待 40 秒）...');
      await this.page.waitForTimeout(40000);
    } else {
      // Wait for confirmation
      const verifyDeadline = Date.now() + 20000;
      while (Date.now() < verifyDeadline) {
        const done = await this.page.evaluate(() =>
          [...document.querySelectorAll('*')].some((el) => {
            const t = el.textContent?.trim();
            return t && (t.includes('发布成功') || t.includes('发布中'));
          })
        );
        if (done) { console.log('  ✅ 发布成功'); break; }
        await this.page.waitForTimeout(800);
      }
    }

    await this.page.waitForTimeout(2000);
    console.log('🎉 发布完成！');
  }

  async close() {
    console.log('\n浏览器保持打开，Ctrl+C 退出...');
    await this.page?.waitForTimeout(30000).catch(() => {});
    await this.browser?.close().catch(() => {});
  }
}

module.exports = XhsBrowser;
