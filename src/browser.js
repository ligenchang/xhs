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
      await this.page.goto('https://creator.xiaohongshu.com/new/home?source=official', { waitUntil: 'domcontentloaded' });
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

  async fillDescription(description) {
    if (!description) return;
    console.log('\n✏️ 填写正文描述...');
    
    // Limit to 1000 characters
    const truncatedDesc = description.length > 1000 
      ? description.substring(0, 1000) 
      : description;
    
    const deadline = Date.now() + 30000; // 30 second timeout
    let attempt = 0;

    while (Date.now() < deadline) {
      attempt++;
      console.log(`  🔍 尝试 ${attempt}: 查找描述框...`);

      // Strategy 1: Use evaluate to find the description field by placeholder text
      const found = await this.page.evaluate((text) => {
        // Look for contenteditable elements with placeholder containing "描述"
        for (const el of document.querySelectorAll('[contenteditable="true"]')) {
          // Check direct data-placeholder
          const placeholder = el.getAttribute('data-placeholder');
          if (placeholder?.includes('描述')) {
            el.click();
            el.focus();
            // Clear content
            el.innerHTML = '';
            // Type the text
            const range = document.createRange();
            const sel = window.getSelection();
            range.selectNodeContents(el);
            sel.removeAllRanges();
            sel.addRange(range);
            el.textContent = text;
            return true;
          }
          
          // Check child elements with placeholder containing "描述"
          const children = el.querySelectorAll('[data-placeholder*="描述"]');
          if (children.length > 0) {
            el.click();
            el.focus();
            el.innerHTML = '';
            const range = document.createRange();
            const sel = window.getSelection();
            range.selectNodeContents(el);
            sel.removeAllRanges();
            sel.addRange(range);
            el.textContent = text;
            return true;
          }
        }
        return false;
      }, truncatedDesc);

      if (found) {
        console.log(`  ✅ 描述已填写 (${truncatedDesc.length}/1000 字)`);
        await this.page.waitForTimeout(500);
        return;
      }

      // Strategy 2: Try keyboard-based approach
      const selectors = [
        'div[contenteditable="true"][class*="ProseMirror"]',
        'div[contenteditable="true"][role="textbox"]',
        'div[contenteditable="true"][class*="tiptap"]',
        'div[contenteditable="true"]',
      ];
      
      const targets = [this.page, ...this.page.frames().filter((f) => f !== this.page.mainFrame())];

      let keyboardSuccess = false;
      for (const target of targets) {
        for (const sel of selectors) {
          const elements = await target.$$(sel).catch(() => []);
          if (!elements.length) continue;

          // Find element with placeholder containing "描述"
          for (const el of elements) {
            const placeholder = await el.getAttribute('data-placeholder').catch(() => null);
            const childPlaceholder = await el.evaluate((e) => 
              e.querySelector('[data-placeholder*="描述"]')?.getAttribute('data-placeholder')
            ).catch(() => null);
            
            const isDescField = placeholder?.includes('描述') || childPlaceholder?.includes('描述');
            if (!isDescField) continue;

            try {
              await el.click();
              await target.waitForTimeout(300);
              await target.keyboard.press('Control+A');
              await target.keyboard.press('Delete');
              await target.waitForTimeout(200);
              
              await target.keyboard.type(truncatedDesc, { delay: 5 });
              
              console.log(`  ✅ 描述已填写 (${truncatedDesc.length}/1000 字)`);
              keyboardSuccess = true;
              break;
            } catch (err) {
              continue;
            }
          }
          if (keyboardSuccess) break;
        }
        if (keyboardSuccess) return;
      }

      // Wait before retry
      const remainingTime = Math.ceil((deadline - Date.now()) / 1000);
      if (remainingTime > 0) {
        console.log(`  ⏳ 未找到，${remainingTime}秒后重试...`);
        await this.page.waitForTimeout(2000);
      }
    }

  }

  async selectRandomTemplate() {
    console.log('\n📱 随机选择排版模版...');
    
    const deadline = Date.now() + 30000; // 30 second timeout
    let attempt = 0;

    while (Date.now() < deadline) {
      attempt++;
      console.log(`  🔍 尝试 ${attempt}: 查找模版列表...`);

      try {
        // Strategy 1: Find and click via Playwright
        const templateCards = await this.page.$$('[class*="template-card"]');
        
        if (!templateCards || templateCards.length === 0) {
          console.log(`  ℹ️ 未找到模版元素，${deadline - Date.now() > 0 ? '重试中...' : '超时'}`);
          await this.page.waitForTimeout(2000);
          continue;
        }

        console.log(`  ℹ️ 找到 ${templateCards.length} 个模版`);

        // Get all template names and filter out "简约基础"
        const availableTemplates = [];
        for (let i = 0; i < templateCards.length; i++) {
          const templateNameEl = await templateCards[i].$('[class*="template-title"]').catch(() => null);
          const templateName = templateNameEl 
            ? await templateNameEl.innerText() 
            : `模版 #${i + 1}`;
          
          // Skip "简约基础" template
          if (templateName !== '简约基础') {
            availableTemplates.push({ index: i, name: templateName });
          }
        }

        if (availableTemplates.length === 0) {
          console.log(`  ⚠️ 没有可用的模版（所有模版都是"简约基础"）`);
          await this.page.waitForTimeout(2000);
          continue;
        }

        // Pick a random template from available ones
        const selected = availableTemplates[Math.floor(Math.random() * availableTemplates.length)];
        const randomIndex = selected.index;
        const randomTemplate = templateCards[randomIndex];
        const templateName = selected.name;
        
        console.log(`  ✅ 随机选择: ${templateName}`);

        // Scroll into view
        await randomTemplate.scrollIntoViewIfNeeded();
        await this.page.waitForTimeout(500);

        // Click using Playwright
        try {
          await randomTemplate.click({ timeout: 3000 });
          console.log('  ✅ 模版已通过 Playwright 点击');
          await this.page.waitForTimeout(1500);
          return true;
        } catch (err) {
          console.log(`  ℹ️ Playwright 点击失败，尝试 JavaScript 点击...`);
          
          // Strategy 2: Use evaluate to get element info and click
          const clickSuccess = await this.page.evaluate((index) => {
            const templates = document.querySelectorAll('[class*="template-card"]');
            if (!templates[index]) return false;

            const template = templates[index];
            const rect = template.getBoundingClientRect();
            const style = window.getComputedStyle(template);

            // Check if clickable
            if (rect.width === 0 || rect.height === 0 || style.pointerEvents === 'none') {
              return false;
            }

            template.scrollIntoView({ behavior: 'smooth', block: 'center' });
            
            // Try multiple click methods
            try {
              template.click();
            } catch (e) {
              const event = new MouseEvent('click', {
                view: window,
                bubbles: true,
                cancelable: true,
              });
              template.dispatchEvent(event);
            }
            
            return true;
          }, randomIndex);

          if (!clickSuccess) {
            console.log('  ⚠️ JavaScript 点击也失败了');
            await this.page.waitForTimeout(2000);
            continue;
          }
          
          console.log('  ✅ 模版已通过 JavaScript 点击');
          await this.page.waitForTimeout(1500);
          return true;
        }

      } catch (err) {
        console.log(`  ⚠️ 错误: ${err.message}`);
      }

      // Wait before retry
      const remainingTime = Math.ceil((deadline - Date.now()) / 1000);
      if (remainingTime > 0) {
        console.log(`  ⏳ 重试中，${remainingTime}秒后...`);
        await this.page.waitForTimeout(2000);
      }
    }

    console.log('  ⚠️ 30秒内未能成功选择模版');
    return false;
  }

  async clickNextStep() {
    console.log('\n➡️ 点击下一步...');
    
    const deadline = Date.now() + 60000; // 60 second timeout
    let attempt = 0;

    while (Date.now() < deadline) {
      attempt++;
      console.log(`  🔍 尝试 ${attempt}: 查找并点击"下一步"...`);

      // Strategy 1: Direct JavaScript evaluation for more reliable clicking
      const directClick = await this.page.evaluate(() => {
        for (const btn of document.querySelectorAll('button, div[role="button"], a')) {
          const text = btn.textContent?.trim();
          const ariaLabel = btn.getAttribute('aria-label');
          
          if ((text === '下一步' || text?.includes('下一步') || ariaLabel?.includes('下一步'))) {
            const rect = btn.getBoundingClientRect();
            const style = window.getComputedStyle(btn);
            
            // Check if element is visible and clickable
            if (rect.width > 0 && rect.height > 0 && rect.top >= 0 &&
                style.pointerEvents !== 'none' && style.opacity !== '0' &&
                !btn.hasAttribute('disabled') && btn.getAttribute('aria-disabled') !== 'true') {
              
              btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
              
              // Use multiple click methods for reliability
              try {
                btn.click();
              } catch (e) {
                const event = new MouseEvent('click', {
                  view: window,
                  bubbles: true,
                  cancelable: true,
                });
                btn.dispatchEvent(event);
              }
              return true;
            }
          }
        }
        return false;
      });

      if (directClick) {
        console.log('  ✅ 找到并点击"下一步"按钮');
        
        // Wait for page load and DOM to update (important!)
        await this.page.waitForTimeout(1000);
        
        // Try to wait for navigation or page load
        try {
          await Promise.race([
            this.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {}),
            this.page.waitForTimeout(3000),
          ]);
        } catch (err) {
          // Timeout is okay
        }
        
        console.log('  ✅ 下一步已点击，等待页面加载');
        await this.page.waitForTimeout(2000);
        return true;
      }

      // Strategy 2: Try finding button by various selectors and click with Playwright
      const selectors = [
        'button:has-text("下一步")',
        'button:has-text("下一步") >> nth=0',
        '[role="button"]:has-text("下一步")',
        'button >> text=下一步',
      ];

      let selectorFound = false;
      for (const sel of selectors) {
        try {
          const btn = await this.page.$(sel).catch(() => null);
          if (btn) {
            console.log(`  ℹ️ 通过选择器找到按钮: ${sel}`);
            await btn.scrollIntoViewIfNeeded();
            await this.page.waitForTimeout(500);
            await btn.click({ timeout: 3000 }).catch(() => {});
            
            // Wait for page load
            await this.page.waitForTimeout(1000);
            try {
              await Promise.race([
                this.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {}),
                this.page.waitForTimeout(3000),
              ]);
            } catch (err) {
              // Timeout is okay
            }
            
            console.log('  ✅ 下一步已点击 (via selector)，等待页面加载');
            await this.page.waitForTimeout(2000);
            selectorFound = true;
            break;
          }
        } catch (err) {
          continue;
        }
      }

      if (selectorFound) {
        return true;
      }

      // Wait before retry
      const remainingTime = Math.ceil((deadline - Date.now()) / 1000);
      if (remainingTime > 0) {
        console.log(`  ⏳ 未找到，${remainingTime}秒后重试...`);
        await this.page.waitForTimeout(2500);
      }
    }

    console.log('  ⚠️ 60秒内未能成功点击"下一步"，返回失败');
    return false;
  }

  async publish() {
    console.log('\n🚀 发布中...');
    await this.page.waitForTimeout(3500);
    // await this.smartClick('下一步', 5000);
    // await this.page.waitForTimeout(2000);

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
