/**
 * publishFromUrl: fetch content from one or multiple URLs → generate post → publish to Xiaohongshu.
 * This allows manual URL input without relying on RSS/news aggregation.
 * Multiple URLs provide richer context for better content generation.
 * Supports both HTML web pages and PDF documents.
 */

const { enrichWithArticles } = require('./sources/article');
const { fetchUrl, htmlToText, isPdfUrl } = require('./sources/fetch');
const { generatePost, generateDescription } = require('./generator');
const XhsBrowser = require('./browser');
const { hashText, save: saveHash } = require('./store');

async function publishFromUrl(urlInput) {
  // Handle both single URL (string) and multiple URLs (array)
  const urls = Array.isArray(urlInput) ? urlInput : [urlInput];

  if (!urls || urls.length === 0) {
    throw new Error('❌ At least one URL is required');
  }

  console.log(`\n📍 Publishing from ${urls.length} URL(s):\n${urls.map((u, i) => `  ${i + 1}. ${u}`).join('\n')}\n`);

  // 1. Create story objects for each URL and enrich with article content
  const stories = urls.map((url, index) => ({
    text: url,
    title: `Article ${index + 1}`,
    url: url,
    source: `Custom URL ${index + 1}`,
    sourceTier: 1,
    pubDate: new Date(),
  }));

  console.log(`🔍 Fetching article content from ${stories.length} source(s)...`);
  
  // Fetch content for each URL
  for (let i = 0; i < stories.length; i++) {
    const story = stories[i];
    const isPdf = isPdfUrl(story.url);
    console.log(`\n${isPdf ? '📄' : '📰'} [${i + 1}/${stories.length}] ${story.url.slice(0, 60)}...`);
    
    try {
      const html = await fetchUrl(story.url, 15000);
      const text = htmlToText(html);
      
      if (text && text.length > 300) {
        story.articleText = text.slice(0, 3000).trim(); // Smaller chunks when combining multiple
        console.log(`  ✅ Fetched: ${story.articleText.length} chars ${isPdf ? '(from PDF)' : ''}`);
      } else {
        if (isPdf && text.length < 300) {
          console.log(`  ⚠️ PDF extraction got minimal content (${text?.length || 0} chars).`);
          console.log(`  💡 Tip: Install pdf-parse for better PDF parsing: npm install pdf-parse`);
          console.log(`  🔄 Skipping this URL...`);
          continue;
        }
        console.log(`  ⚠️ Direct fetch got too little content (${text?.length || 0} chars), trying enriched extraction...`);
        await enrichWithArticles([story], 1);
      }
    } catch (err) {
      console.log(`  ⚠️ Direct fetch failed (${err.message}), trying enriched extraction...`);
      await enrichWithArticles([story], 1);
    }

    if (!story.articleText) {
      console.log(`  ⚠️ Could not fetch content from URL ${i + 1}, skipping...`);
      stories.splice(i, 1);
      i--;
    }
  }

  if (stories.length === 0) {
    throw new Error('❌ Failed to fetch article content from any of the provided URLs');
  }

  // 2. Build the content bundle for the generator (combining multiple sources)
  const bundle = buildBundle(stories);

  console.log('\n' + '='.repeat(70));
  console.log('📍 SOURCE BUNDLE (Combined Context)');
  console.log('='.repeat(70));
  console.log(bundle);
  console.log('='.repeat(70) + '\n');

  // 3. Generate Chinese post via AI
  const { title, content } = await generatePost(bundle);

  console.log('\n' + '='.repeat(70));
  console.log('✨ GENERATED POST');
  console.log('='.repeat(70));
  console.log(`\n【标题】\n${title}`);
  console.log(`\n【正文】\n${content}`);
  console.log('\n' + '='.repeat(70) + '\n');

  // 4. Generate description with LLM
  const description = await generateDescription(title, content);

  console.log('\n' + '='.repeat(70));
  console.log('📝 GENERATED DESCRIPTION');
  console.log('='.repeat(70));
  console.log(`\n【正文描述】\n${description}`);
  console.log('\n' + '='.repeat(70) + '\n');

  // 5. Open browser and publish
  const browser = new XhsBrowser();
  
  try {
    await browser.init();
    await browser.loadCookies();
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

  // 6. Record as published (hash the bundle so we don't republish the same story)
  saveHash(hashText(bundle));
  console.log('📌 Recorded as published');
  console.log('\n✅ Done!');
}

function buildBundle(stories) {
  const parts = [];

  // Header with all sources
  parts.push(`SOURCES: ${stories.length} URL(s)`);
  stories.forEach((story, i) => {
    parts.push(`  ${i + 1}. ${story.source}`);
    if (story.url) parts.push(`     URL: ${story.url}`);
  });
  
  if (stories[0]?.pubDate) {
    parts.push(`DATE: ${stories[0].pubDate.toISOString()}`);
  }
  parts.push('');

  // Combine article content from all stories
  parts.push('COMBINED ARTICLES:');
  parts.push('');
  
  stories.forEach((story, i) => {
    if (story.articleText) {
      parts.push(`[Source ${i + 1}] ${story.source}`);
      parts.push(story.articleText);
      parts.push('');
    }
  });

  // Instruction to include all URLs
  if (stories.length > 0) {
    parts.push('INSTRUCTION: 必须在文章末尾包含所有原文链接。在正文最后添加：');
    parts.push('参考链接：');
    stories.forEach((story, i) => {
      if (story.url) {
        parts.push(`  ${i + 1}. ${story.url}`);
      }
    });
  }

  return parts.join('\n');
}

module.exports = { publishFromUrl };
