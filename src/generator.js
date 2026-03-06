/**
 * AI content generation: translate English news into a Xiaohongshu post.
 */

const OpenAI = require('openai').default;
const config = require('./config');
const { SYSTEM_PROMPT, CONTENT_PROMPT } = require('./prompts');

const MIN_CHARS    = 600;
const MAX_ATTEMPTS = 3;
const REASONING_FLUSH_SIZE = 200;

function getClient() {
  return new OpenAI({ apiKey: config.ai.apiKey, baseURL: config.ai.baseURL });
}

/**
 * Some reasoning models (nemotron) put the entire final answer inside
 * reasoning_content and leave content empty. When that happens we need to
 * extract just the answer portion from the reasoning dump — not pass the
 * whole chain-of-thought to parseContent.
 *
 * The model reliably ends its thinking with patterns like:
 *   "Final answer:", "Here is the post:", a line of ═══, or simply a
 *   blank line followed by the Chinese title on its own line.
 *
 * Strategy: find the last plausible "answer starts here" boundary and
 * return everything after it. Fall back to the last 3000 chars if nothing
 * matches (the answer is always at the end of the reasoning dump).
 */
function extractAnswerFromReasoning(reasoning) {
  const text = reasoning.trim();

  // Common explicit answer-start markers the model uses
  const markers = [
    /(?:^|\n)\s*(?:final answer|here is the post|here's the post|output:|post:)\s*[:\n]/im,
    /(?:^|\n)\s*[═─━]{5,}/m,   // horizontal rule the model sometimes draws
    /(?:^|\n)\s*---+\s*\n/m,   // markdown HR
  ];

  for (const marker of markers) {
    const match = marker.exec(text);
    if (match) {
      const after = text.slice(match.index + match[0].length).trim();
      // Only accept if there's substantial content after the marker
      if (after.replace(/\s/g, '').length > 200) {
        console.log('  ℹ️  Extracted answer from reasoning via marker');
        return after;
      }
    }
  }

  // Heuristic: find the last blank line after which Chinese characters appear
  // (the post body is Chinese; the reasoning is English)
  const chineseBlockRe = /\n\n([\s\S]{200,})$/;
  const chineseMatch = chineseBlockRe.exec(text);
  if (chineseMatch && /[\u4e00-\u9fff]/.test(chineseMatch[1])) {
    console.log('  ℹ️  Extracted answer from reasoning via Chinese block heuristic');
    return chineseMatch[1].trim();
  }

  // Last resort: take the final 3000 characters — answer is always at the end
  console.log('  ℹ️  Extracted answer from reasoning via tail fallback');
  return text.slice(-3000).trim();
}

/**
 * Stream a completion, keeping reasoning tokens and final content separate.
 *
 * Reasoning models stream chain-of-thought in delta.reasoning_content first,
 * then emit the final answer in delta.content.
 *
 * Reasoning is batched (REASONING_FLUSH_SIZE) to avoid thousands of tiny
 * terminal writes — that was causing the slow streaming.
 *
 * If delta.content is never populated, extractAnswerFromReasoning() pulls
 * just the answer out of the reasoning dump instead of passing the whole
 * thing to parseContent (which caused the reasoning text to become the title).
 */
async function streamCompletion(messages, temperature = 0.7) {
  const openai = getClient();
  const stream = await openai.chat.completions.create({
    model: config.ai.model,
    messages,
    temperature,
    top_p: 0.9,
    max_tokens: 8192,
    stream: true,
  });

  let finalContent     = '';
  let reasoningContent = '';
  let reasoningBuffer  = '';

  process.stdout.write('  [thinking] ');

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta;
    if (!delta) continue;

    if (delta.content) {
      // Flush buffered reasoning before switching to the answer
      if (reasoningBuffer) {
        process.stdout.write(reasoningBuffer);
        reasoningBuffer = '';
      }
      if (!finalContent) process.stdout.write('\n\n  [answer]\n  ');
      finalContent += delta.content;
      process.stdout.write(delta.content); // stream answer live, token by token

    } else if (delta.reasoning_content || delta.reasoning) {
      const part = delta.reasoning_content || delta.reasoning;
      reasoningContent += part;
      reasoningBuffer  += part;
      // Flush in batches — reduces terminal syscalls from thousands to tens
      if (reasoningBuffer.length >= REASONING_FLUSH_SIZE) {
        process.stdout.write(reasoningBuffer);
        reasoningBuffer = '';
      }
    }
  }

  if (reasoningBuffer) process.stdout.write(reasoningBuffer);
  console.log('\n');

  if (!finalContent) {
    if (!reasoningContent) throw new Error('Model returned no output');
    console.warn('  ⚠️  delta.content was empty — extracting answer from reasoning_content');
    return extractAnswerFromReasoning(reasoningContent);
  }

  return finalContent;
}

/**
 * Parse the model output into { title, content }.
 * Expected format: title on line 1, blank line, body from line 3 onward.
 */
function parseContent(raw) {
  const lines = raw.trim().split('\n');

  let titleLine = '';
  let bodyStart = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line) {
      titleLine = line.replace(/^[#*>\-=\s【】\[\]「」]+/, '').trim();
      bodyStart = i + 1;
      break;
    }
  }

  while (bodyStart < lines.length && !lines[bodyStart].trim()) bodyStart++;

  const content = lines.slice(bodyStart).join('\n').trim();

  if (!titleLine || !content) throw new Error('格式异常：无法解析标题或正文');

  // Sanity check: title should be Chinese or at least short — not a reasoning sentence
  if (titleLine.length > 60 || /^(let me|i need|first|okay|so |the model|step \d)/i.test(titleLine)) {
    throw new Error('格式异常：标题看起来是推理内容而非文章标题');
  }

  const charCount = content.replace(/\s/g, '').length;
  if (charCount < MIN_CHARS) throw new Error(`字数不足 (${charCount} 字，最少 ${MIN_CHARS} 字)`);

  console.log(`  ✅ 标题: ${titleLine}`);
  console.log(`  ✅ 正文: ${charCount} 字`);
  return { title: titleLine, content };
}

/**
 * Generate a Xiaohongshu post from a news bundle.
 * Retries with escalating guidance if output is too short or malformed.
 */
async function generatePost(news) {
  const retryInstructions = [
    null,
    '上一次太短。写完整的、详细的文章。每个部分都要展开，目标 1200 字以上的正文。',
    '还是太短。完整写出所有内容，不要压缩、不要简略。展开每个部分。',
  ];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    console.log(`\n✍️  生成文章 (第 ${attempt}/${MAX_ATTEMPTS} 次)...`);

    const extra = retryInstructions[attempt - 1];
    const userPrompt = extra
      ? `${CONTENT_PROMPT(news)}\n\n特别说明：${extra}`
      : CONTENT_PROMPT(news);

    try {
      const raw = await streamCompletion([
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ]);
      return parseContent(raw);
    } catch (err) {
      const isQualityIssue = err.message.includes('字数不足')
        || err.message.includes('格式异常')
        || err.message.includes('推理内容');
      if (isQualityIssue && attempt < MAX_ATTEMPTS) {
        console.warn(`  ⚠️  ${err.message} — retrying...`);
      } else {
        throw err;
      }
    }
  }
}

module.exports = { generatePost };
