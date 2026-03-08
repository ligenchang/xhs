/**
 * publish: fetch news bundle → generate post → publish to Xiaohongshu.
 */

const { findBestStory } = require('./news');
const { generatePost, generateDescription }  = require('./generator');
const XhsBrowser        = require('./browser');
const { hashText, save: saveHash } = require('./store');

async function publish() {
  console.log('📊 Starting publish pipeline...\n');

  // 1. Find the best story — returns an enriched text bundle
  const bundle = await findBestStory();

  console.log('\n' + '='.repeat(70));
  console.log('📍 SOURCE BUNDLE');
  console.log('='.repeat(70));
  console.log(bundle);
  console.log('='.repeat(70) + '\n');

  // 2. Generate Chinese post via AI
  const { title, content } = await generatePost(bundle);

  console.log('\n' + '='.repeat(70));
  console.log('✨ GENERATED POST');
  console.log('='.repeat(70));
  console.log(`\n【标题】\n${title}`);
  console.log(`\n【正文】\n${content}`);
  console.log('\n' + '='.repeat(70) + '\n');

  // 2b. Generate description with LLM
  const description = await generateDescription(title, content);

  console.log('\n' + '='.repeat(70));
  console.log('📝 GENERATED DESCRIPTION');
  console.log('='.repeat(70));
  console.log(`\n【正文描述】\n${description}`);
  console.log('\n' + '='.repeat(70) + '\n');

  // 3. Open browser and publish
  const browser = new XhsBrowser();
  
  try {
    await browser.init();
    await browser.loadCookies();
    // await browser.ensureLoggedIn();
    await browser.navigateToEditor();
    await browser.fillTitle(title);
    await browser.page.waitForTimeout(500);
    await browser.fillContent(content);

    await browser.page.waitForTimeout(500);
    await browser.smartClick('一键排版', 10000).catch(() => {});
    await browser.page.waitForTimeout(2000);

    // Random select a template
    await browser.selectRandomTemplate();
    await browser.page.waitForTimeout(3000);

    // Click next step to confirm
    await browser.clickNextStep();

    await browser.page.waitForTimeout(500);
    await browser.fillDescription(description);
    await browser.publish();
    await browser.saveCookies();
  } finally {
    await browser.close();
  }

  // 4. Record as published (hash the bundle so we don't republish the same story)
  saveHash(hashText(bundle));
  console.log('📌 Recorded as published');
  console.log('\n✅ Done!');
}

module.exports = { publish };
