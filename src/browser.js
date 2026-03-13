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

    // Randomise viewport so every session looks slightly different
    const vpW = 1280 + Math.floor(Math.random() * 161); // 1280-1440
    const vpH = 800  + Math.floor(Math.random() * 121); // 800-920

    this.browser = await chromium.launch({
      headless: config.browser.headless,
      slowMo: config.browser.slowMo,
      args: [
        '--no-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-site-isolation-trials',
        '--disable-dev-shm-usage',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-infobars',
        `--window-size=${vpW},${vpH + 80}`,
      ],
    });

    this.context = await this.browser.newContext({
      viewport: { width: vpW, height: vpH },
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
      locale: 'zh-CN',
      timezoneId: 'Asia/Shanghai',
      colorScheme: 'light',
      deviceScaleFactor: 2,   // Retina — typical modern Mac
      hasTouch: false,
      extraHTTPHeaders: { 'Accept-Language': 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7' },
    });

    // ── Comprehensive stealth init script ────────────────────────────────────
    await this.context.addInitScript(() => {
      // 1. Remove webdriver flag
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

      // 2. Realistic navigator properties for a Mac
      const overrides = {
        platform:             { get: () => 'MacIntel' },
        hardwareConcurrency:  { get: () => 8 },
        deviceMemory:         { get: () => 8 },
        languages:            { get: () => Object.freeze(['zh-CN', 'zh', 'en-US', 'en']) },
        appVersion: {
          get: () =>
            '5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
        },
      };
      for (const [key, descriptor] of Object.entries(overrides)) {
        try { Object.defineProperty(navigator, key, { ...descriptor, configurable: true }); } catch (_) {}
      }

      // 3. Fake navigator.plugins (headless normally has 0 plugins)
      const pluginDefs = [
        {
          name: 'PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format',
          mimes: [{ type: 'application/pdf', suffixes: 'pdf', description: 'Portable Document Format' }],
        },
        {
          name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '',
          mimes: [{ type: 'application/x-google-chrome-pdf', suffixes: 'pdf', description: '' }],
        },
        {
          name: 'Chromium PDF Viewer', filename: 'internal-pdf-viewer', description: '',
          mimes: [{ type: 'application/x-chromium-pdf', suffixes: 'pdf', description: '' }],
        },
      ];
      try {
        const fakePlugins = pluginDefs.map((def) => {
          const p = { name: def.name, filename: def.filename, description: def.description, length: def.mimes.length };
          def.mimes.forEach((m, i) => {
            p[i] = { type: m.type, suffixes: m.suffixes, description: m.description, enabledPlugin: p };
          });
          return p;
        });
        const pluginArr = { length: fakePlugins.length, item: (i) => fakePlugins[i], namedItem: (n) => fakePlugins.find((p) => p.name === n) || null, refresh: () => {} };
        fakePlugins.forEach((p, i) => { pluginArr[i] = p; });
        Object.defineProperty(navigator, 'plugins', { get: () => pluginArr, configurable: true });
        Object.defineProperty(navigator, 'mimeTypes', { get: () => ({ length: 3, item: () => null, namedItem: () => null }), configurable: true });
      } catch (_) {}

      // 4. window.chrome — required by many fingerprint checks
      if (!window.chrome) {
        const runtime = {
          connect: () => {}, sendMessage: () => {}, id: undefined,
          OnInstalledReason: { CHROME_UPDATE: 'chrome_update', INSTALL: 'install', UPDATE: 'update', SHARED_MODULE_UPDATE: 'shared_module_update' },
          PlatformOs:   { MAC: 'mac', WIN: 'win', LINUX: 'linux', ANDROID: 'android', CROS: 'cros', OPENBSD: 'openbsd' },
          PlatformArch: { ARM: 'arm', ARM64: 'arm64', X86_32: 'x86-32', X86_64: 'x86-64', MIPS: 'mips', MIPS64: 'mips64' },
          RequestUpdateCheckStatus: { THROTTLED: 'throttled', NO_UPDATE: 'no_update', UPDATE_AVAILABLE: 'update_available' },
          OnRestartRequiredReason: { APP_UPDATE: 'app_update', OS_UPDATE: 'os_update', GC_PRESSURE: 'gc_pressure' },
        };
        const chromeObj = {
          app:      { isInstalled: false },
          runtime,
          csi:        () => ({ startE: Date.now(), onloadT: Date.now(), pageT: 1000, tran: 15 }),
          loadTimes: () => ({
            requestTime: performance.timing.navigationStart / 1000,
            startLoadTime: performance.timing.navigationStart / 1000,
            commitLoadTime: performance.timing.responseStart / 1000,
            finishDocumentLoadTime: performance.timing.domContentLoadedEventEnd / 1000,
            finishLoadTime: performance.timing.loadEventEnd / 1000,
            firstPaintTime: performance.timing.domContentLoadedEventEnd / 1000,
            firstPaintAfterLoadTime: 0, navigationType: 'Other',
            wasFetchedViaSpdy: false, wasNpnNegotiated: true, npnNegotiatedProtocol: 'h2',
            wasAlternateProtocolAvailable: false, connectionInfo: 'h2',
          }),
        };
        try { Object.defineProperty(window, 'chrome', { value: chromeObj, configurable: true, writable: false, enumerable: false }); }
        catch (_) { window.chrome = chromeObj; }
      }

      // 5. Fix Permissions API — headless returns 'denied' for notifications by default
      try {
        const origQuery = navigator.permissions.query.bind(navigator.permissions);
        navigator.permissions.query = (params) => {
          if (params.name === 'notifications')
            return Promise.resolve({ state: 'prompt', onchange: null });
          return origQuery(params);
        };
      } catch (_) {}

      // 6. WebGL vendor / renderer — fake Intel Mac GPU
      for (const Ctx of [WebGLRenderingContext, window.WebGL2RenderingContext].filter(Boolean)) {
        try {
          const orig = Ctx.prototype.getParameter;
          Ctx.prototype.getParameter = function (p) {
            if (p === 37445) return 'Intel Inc.';                 // UNMASKED_VENDOR_WEBGL
            if (p === 37446) return 'Intel Iris OpenGL Engine';   // UNMASKED_RENDERER_WEBGL
            return orig.call(this, p);
          };
        } catch (_) {}
      }

      // 7. Slightly perturb canvas fingerprint so it differs each session
      try {
        const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
        HTMLCanvasElement.prototype.toDataURL = function (...args) {
          const ctx2d = this.getContext('2d');
          if (ctx2d) {
            const imageData = ctx2d.getImageData(0, 0, this.width || 1, this.height || 1);
            // Flip one pixel's alpha by ±1 — invisible but changes hash
            if (imageData.data.length > 3) imageData.data[3] ^= 1;
            ctx2d.putImageData(imageData, 0, 0);
          }
          return origToDataURL.apply(this, args);
        };
      } catch (_) {}

      // 8. Clean up known automation artifacts
      try { delete window.cdc_adoQpoasnfa76pfcZLmcfl_Array;   } catch (_) {}
      try { delete window.cdc_adoQpoasnfa76pfcZLmcfl_Promise; } catch (_) {}
      try { delete window.cdc_adoQpoasnfa76pfcZLmcfl_Symbol;  } catch (_) {}

      // 9. Screen colour depth (headless default is often 24 but confirm it)
      try { Object.defineProperty(screen, 'colorDepth', { get: () => 24, configurable: true }); } catch (_) {}
      try { Object.defineProperty(screen, 'pixelDepth',  { get: () => 24, configurable: true }); } catch (_) {}
    });
    // ─────────────────────────────────────────────────────────────────────────

    this.page = await this.context.newPage();
    this.page.setDefaultTimeout(config.browser.timeout);
  }

  async loadCookies() {
    if (!fs.existsSync(config.cookiesFile)) return;
    console.log('📂 加载 Cookie...');
    const raw = JSON.parse(fs.readFileSync(config.cookiesFile, 'utf-8'));
    // Sanitize: only keep fields Playwright accepts, fix invalid combinations
    const cookies = raw
      .map((c) => {
        // Strip non-printable / non-ASCII bytes that corrupt values
        // eslint-disable-next-line no-control-regex
        const value = (c.value || '').replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '');
        const cookie = { name: c.name, value, domain: c.domain, path: c.path || '/' };
        if (typeof c.expires === 'number' && c.expires > 0) cookie.expires = c.expires;
        if (typeof c.httpOnly === 'boolean') cookie.httpOnly = c.httpOnly;
        if (typeof c.secure === 'boolean') cookie.secure = c.secure;
        // sameSite "None" requires secure=true; fall back to "Lax" otherwise
        if (c.sameSite === 'None') {
          cookie.sameSite = 'None';
          cookie.secure = true;
        } else if (c.sameSite === 'Strict' || c.sameSite === 'Lax') {
          cookie.sameSite = c.sameSite;
        }
        return cookie;
      })
      .filter((c) => c.name && c.value); // skip blank/corrupt entries
    if (cookies.length === 0) {
      console.log('⚠️  Cookie 文件为空或无效，跳过加载');
      return;
    }
    await this.context.addCookies(cookies);
    console.log(`  ✅ 已加载 ${cookies.length} 个 Cookie`);
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
      // Return the center coordinates of the target element rather than calling
      // el.click() — Playwright's mouse.click() is a real browser-level event
      // that reliably triggers custom JS handlers XHS uses.
      const coords = await this.page.evaluate((text) => {
        for (const el of document.querySelectorAll('a, button, span, div, li')) {
          if (el.children.length > 0 && el.tagName !== 'BUTTON' && el.tagName !== 'A') continue;
          const t = el.innerText?.trim();
          if (!t || !(t === text || t.includes(text))) continue;
          const style = window.getComputedStyle(el);
          if (style.pointerEvents === 'none' || style.opacity === '0' || style.display === 'none' || style.visibility === 'hidden') continue;
          if (el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true') continue;
          el.scrollIntoView({ block: 'center', inline: 'nearest' });
          const rect = el.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) continue;
          return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        }
        return null;
      }, labelText);

      if (coords) {
        // Small settle time after scrollIntoView before the real mouse click
        await this.page.waitForTimeout(300);
        await this.page.mouse.click(coords.x, coords.y);
        console.log(`  ✅ 点击: "${labelText}"`);
        await this.page.waitForTimeout(1500);
        return true;
      }

      await this.page.waitForTimeout(500);
    }

    console.log(`  ⚠️ 未找到 "${labelText}"，跳过`);
    return false;
  }

  async navigateToEditor() {
    console.log('\n📝 打开长文编辑器...');
    if (!this.page.url().includes('creator.xiaohongshu.com')) {
      await this.page.goto('https://creator.xiaohongshu.com/new/home?source=official', { waitUntil: 'domcontentloaded' });
    }
    await Promise.race([
      this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {}),
      this.page.waitForTimeout(5000),
    ]);

    // Click "发布笔记" then verify "写长文" appears; retry up to 6 times if not.
    const isVisible = (text) =>
      this.page.evaluate((t) =>
        [...document.querySelectorAll('a, button, span, div, li')].some((el) => {
          if (el.children.length > 0 && el.tagName !== 'BUTTON' && el.tagName !== 'A') return false;
          const txt = el.innerText?.trim();
          if (!txt || !txt.includes(t)) return false;
          const r = el.getBoundingClientRect();
          if (r.width <= 0 || r.height <= 0) return false;
          const s = window.getComputedStyle(el);
          return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
        }), text
      );

    let dropdownOpen = false;
    for (let attempt = 1; attempt <= 6 && !dropdownOpen; attempt++) {
      console.log(`  🔁 发布笔记 尝试 ${attempt}...`);
      await this.smartClick('发布笔记', 10000);
      // Wait up to 3s for the dropdown item "写长文" to appear
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline) {
        if (await isVisible('写长文')) { dropdownOpen = true; break; }
        await this.page.waitForTimeout(300);
      }
      if (!dropdownOpen) {
        console.log('  ↩️ 下拉未出现，重试...');
        await this.page.waitForTimeout(500);
      }
    }

    await this.smartClick('写长文', 20000);
    await this.page.waitForTimeout(1500);

    // Poll up to 5s for "新的创作" dialog (appears when a draft already exists)
    const newDeadline = Date.now() + 5000;
    let hasNew = false;
    while (Date.now() < newDeadline) {
      hasNew = await this.page.evaluate(() =>
        [...document.querySelectorAll('a, button, span, div')].some((el) => {
          const rect = el.getBoundingClientRect();
          return el.innerText?.trim() === '新的创作' && rect.width > 0 && rect.top >= 0;
        })
      );
      if (hasNew) break;
      await this.page.waitForTimeout(300);
    }
    if (hasNew) {
      console.log('  🔍 发现"新的创作"，点击...');
      const editorSels = [
        'input[placeholder*="标题"]',
        'textarea[placeholder*="标题"]',
        '[contenteditable][placeholder*="标题"]',
        '.ProseMirror',
        '[contenteditable="true"]',
      ];
      const editorAppeared = async () => {
        for (const sel of editorSels) {
          const el = await this.page.$(sel).catch(() => null);
          if (el) return true;
        }
        return false;
      };

      for (let i = 0; i < 5; i++) {
        // Wait until the button is stable before clicking
        let btnCoords = null;
        const stableDeadline = Date.now() + 3000;
        while (Date.now() < stableDeadline) {
          btnCoords = await this.page.evaluate(() => {
            for (const el of document.querySelectorAll('a, button, span, div')) {
              if (el.innerText?.trim() !== '新的创作') continue;
              const rect = el.getBoundingClientRect();
              if (rect.width <= 0 || rect.height <= 0 || rect.top < 0) continue;
              const s = window.getComputedStyle(el);
              if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0' || s.pointerEvents === 'none') continue;
              return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
            }
            return null;
          });
          if (btnCoords) break;
          await this.page.waitForTimeout(200);
        }
        if (!btnCoords) { console.log('  ✅ 按钮不再可见，视为成功'); break; }

        await this.page.waitForTimeout(300);
        await this.page.mouse.click(btnCoords.x, btnCoords.y);
        console.log(`  ✅ 点击"新的创作" (尝试 ${i + 1})`);

        // Success = editor appears, not dialog disappears
        const successDeadline = Date.now() + 3000;
        let success = false;
        while (Date.now() < successDeadline) {
          if (await editorAppeared()) { success = true; break; }
          await this.page.waitForTimeout(200);
        }
        if (success) { console.log('  ✅ 编辑器已出现，点击成功'); break; }
        await this.page.waitForTimeout(500);
      }
    }

    // Wait for the editor to actually load (title input must appear)
    console.log('  ⏳ 等待编辑器加载...');
    const editorSelectors = [
      'input[placeholder*="标题"]',
      'textarea[placeholder*="标题"]',
      '[contenteditable][placeholder*="标题"]',
      '.ProseMirror',
      '[contenteditable="true"]',
    ];
    const editorDeadline = Date.now() + 15000;
    let editorReady = false;
    while (Date.now() < editorDeadline) {
      for (const sel of editorSelectors) {
        const el = await this.page.$(sel).catch(() => null);
        if (el) { editorReady = true; break; }
      }
      if (editorReady) break;
      await this.page.waitForTimeout(500);
    }
    if (editorReady) {
      console.log('  ✅ 编辑器已加载');
    } else {
      console.log('  ⚠️ 编辑器加载超时，继续尝试...');
    }
    await this.page.waitForTimeout(1000);
  }

  async fillTitle(title) {
    if (!title) return;
    console.log('\n✏️ 填写标题...');
    const selectors = [
      'input[placeholder*="标题"]',
      'textarea[placeholder*="标题"]',
      '[contenteditable][placeholder*="标题"]',
    ];
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
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
      await this.page.waitForTimeout(500);
    }
    console.log('  ⚠️ 未找到标题框，跳过');
  }

  async fillContent(content) {
    console.log('\n✏️ 填写正文...');
    const selectors = ['.ProseMirror', '[contenteditable="true"][class*="editor"]', '[contenteditable="true"]'];
    const deadline = Date.now() + 20000;

    while (Date.now() < deadline) {
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

          const lines = content.split('\n');
          for (let i = 0; i < lines.length; i++) {
            if (lines[i]) await target.keyboard.type(lines[i], { delay: 30 });
            if (i < lines.length - 1) await target.keyboard.press('Enter');
          }

          console.log('  ✅ 正文已填写');
          return;
        }
      }
      await this.page.waitForTimeout(500);
    }
    console.log('  ⚠️ 未找到编辑器，跳过');
  }

  async fillDescription(description) {
    if (!description) return;
    console.log('\n✏️ 填写正文描述...');

    // Limit to 1000 characters
    const truncatedDesc = description.length > 1000
      ? description.substring(0, 1000)
      : description;

    const selectors = [
      'div[contenteditable="true"][class*="ProseMirror"]',
      'div[contenteditable="true"][role="textbox"]',
      'div[contenteditable="true"][class*="tiptap"]',
      'div[contenteditable="true"]',
    ];

    // Retry loop — the description box may appear after JS hydration
    const deadline = Date.now() + 25000;
    while (Date.now() < deadline) {
      const targets = [this.page, ...this.page.frames().filter((f) => f !== this.page.mainFrame())];

      for (const target of targets) {
        for (const sel of selectors) {
          const elements = await target.$$(sel).catch(() => []);
          if (!elements.length) continue;

          for (const el of elements) {
            const placeholder = await el.getAttribute('data-placeholder').catch(() => null);
            const childPlaceholder = await el.evaluate((e) =>
              e.querySelector('[data-placeholder*="描述"]')?.getAttribute('data-placeholder')
            ).catch(() => null);

            const isDescField = placeholder?.includes('描述') || childPlaceholder?.includes('描述');
            if (!isDescField) continue;

            try {
              await el.scrollIntoViewIfNeeded();
              await el.click();
              await target.waitForTimeout(300);

              await target.keyboard.press('Control+A');
              await target.keyboard.press('Delete');
              await target.waitForTimeout(200);

              await target.keyboard.type(truncatedDesc, { delay: 5 });

              console.log(`  ✅ 描述已填写 (${truncatedDesc.length}/1000 字)`);
              await this.page.waitForTimeout(500);
              return;
            } catch (err) {
              continue;
            }
          }
        }
      }

      // Not found yet — wait and retry
      await this.page.waitForTimeout(500);
    }

    console.log('  ⚠️ 未找到描述框，跳过');
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

        // Get all template names and filter out excluded templates
        const EXCLUDED_TEMPLATES = ['简约基础', '札记集尘'];
        const availableTemplates = [];
        for (let i = 0; i < templateCards.length; i++) {
          const templateNameEl = await templateCards[i].$('[class*="template-title"]').catch(() => null);
          const templateName = templateNameEl 
            ? await templateNameEl.innerText() 
            : `模版 #${i + 1}`;
          
          // Skip excluded templates
          if (!EXCLUDED_TEMPLATES.includes(templateName)) {
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
        await this.page.waitForTimeout(2000);

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
