/**
 * Category rotation — ensures posts cycle across different topic areas
 * instead of always picking the highest-scoring story (which is always
 * breaking news from major labs).
 *
 * Categories and their recent-use history are persisted in
 * data/rotation.json. On each run we pick the category that was used
 * least recently, then select the best story within that category.
 *
 * Categories (7 distinct content types):
 *   frontier_models   — GPT, Claude, Gemini, Llama releases & benchmarks
 *   coding_tools      — Cursor, Copilot, Devin, Claude Code, Windsurf
 *   agents            — CrewAI, LangGraph, AutoGen, Manus, agentic workflows
 *   infra_apis        — Groq, Ollama, OpenRouter, APIs, deployment, cost
 *   research          — arXiv papers, benchmarks, alignment, techniques
 *   emerging          — HuggingFace trending, new tools, HN discoveries
 *   productivity      — Notion AI, Perplexity, v0, no-code builders
 */

const fs   = require('fs');
const path = require('path');

const ROTATION_FILE = path.resolve('./data/rotation.json');

// ─── Category definitions ─────────────────────────────────────────────────────
// Each category has keywords matched against the story text (lowercase).
// A story is assigned the FIRST category whose keywords match.
// Stories that match nothing go to 'emerging'.

const CATEGORIES = [
  {
    id: 'frontier_models',
    label: 'Frontier Models',
    keywords: [
      'gpt-5', 'gpt-4', 'o3', 'o4', 'claude 4', 'claude 3', 'gemini 2', 'gemini 3',
      'llama 4', 'llama 3', 'grok 3', 'grok 4', 'deepseek', 'qwen', 'phi-4', 'mistral',
      'command r', 'gemma', 'openai model', 'anthropic model', 'new model', 'model release',
      'benchmark', 'mmlu', 'humaneval', 'swe-bench', 'context window', 'tokens per second',
    ],
  },
  {
    id: 'coding_tools',
    label: 'Coding Tools',
    keywords: [
      'cursor', 'windsurf', 'copilot', 'devin', 'claude code', 'replit', 'codeium',
      'aider', 'zed', 'cline', 'continue dev', 'tabnine', 'code generation',
      'coding assistant', 'ai editor', 'ide', 'autocomplete', 'code review',
    ],
  },
  {
    id: 'agents',
    label: 'AI Agents',
    keywords: [
      'agent', 'agentic', 'multi-agent', 'crewai', 'langgraph', 'autogen', 'manus',
      'openhand', 'swe-agent', 'autonomous', 'workflow automation', 'tool use',
      'function calling', 'mcp', 'model context protocol', 'computer use',
    ],
  },
  {
    id: 'infra_apis',
    label: 'Infrastructure & APIs',
    keywords: [
      'groq', 'ollama', 'openrouter', 'together ai', 'fireworks', 'modal',
      'inference api', 'llm api', 'deployment', 'serving', 'latency', 'throughput',
      'cost per token', 'gpu', 'tpu', 'lpu', 'vllm', 'tensorrt', 'quantiz',
      'onnx', 'mlx', 'llama.cpp', 'hugging face api', 'nvidia', 'amd',
    ],
  },
  {
    id: 'research',
    label: 'Research & Papers',
    keywords: [
      'arxiv', 'paper', 'research', 'we propose', 'we present', 'we introduce',
      'alignment', 'rlhf', 'dpo', 'fine-tun', 'rag', 'retrieval augmented',
      'embedding', 'attention', 'transformer', 'diffusion', 'multimodal',
      'hallucination', 'reasoning chain', 'chain-of-thought', 'prompt engineering',
    ],
  },
  {
    id: 'productivity',
    label: 'AI Productivity Tools',
    keywords: [
      'perplexity', 'notion ai', 'v0.dev', 'bolt.new', 'lovable', 'dify',
      'flowise', 'n8n', 'zapier', 'make.com', 'no-code', 'low-code',
      'chatbot', 'assistant', 'productivity', 'writing tool', 'search ai',
    ],
  },
  {
    id: 'emerging',
    label: 'Emerging & Trending',
    keywords: [], // catch-all — everything that doesn't match above
  },
];

// ─── Assign a category to a story ────────────────────────────────────────────

function categorize(item) {
  const lower = (item.text + ' ' + (item.title || '')).toLowerCase();
  for (const cat of CATEGORIES) {
    if (cat.keywords.length === 0) return cat.id; // catch-all
    if (cat.keywords.some((kw) => lower.includes(kw))) return cat.id;
  }
  return 'emerging';
}

// ─── Rotation state persistence ───────────────────────────────────────────────

function loadRotation() {
  try {
    if (fs.existsSync(ROTATION_FILE)) {
      return JSON.parse(fs.readFileSync(ROTATION_FILE, 'utf-8'));
    }
  } catch (_) {}
  // Initialize with all categories at epoch 0 (none used yet)
  return { lastUsed: Object.fromEntries(CATEGORIES.map((c) => [c.id, 0])) };
}

function saveRotation(state) {
  try {
    fs.mkdirSync(path.dirname(ROTATION_FILE), { recursive: true });
    fs.writeFileSync(ROTATION_FILE, JSON.stringify(state, null, 2));
  } catch (_) {}
}

// ─── Main selection logic ─────────────────────────────────────────────────────

/**
 * Given a scored list of candidates, pick the best story from the
 * category that was used least recently.
 *
 * Falls back to the globally best story if the target category has
 * no qualifying candidates.
 *
 * Also adds a small score jitter (±10%) so runs with similar candidates
 * don't always pick the identical top item.
 */
function selectWithRotation(scoredCandidates, minScore = 5) {
  const rotation = loadRotation();

  // Assign category to every candidate + apply score jitter
  const candidates = scoredCandidates.map((c) => ({
    ...c,
    category: categorize(c),
    // ±10% random jitter prevents always picking the same top item
    jitteredScore: c.score * (0.9 + Math.random() * 0.2),
  }));

  // Find which category was used least recently
  const categoryOrder = CATEGORIES
    .map((cat) => ({ id: cat.id, label: cat.label, lastUsed: rotation.lastUsed[cat.id] || 0 }))
    .sort((a, b) => a.lastUsed - b.lastUsed);

  console.log('\n🎲 Category rotation state:');
  categoryOrder.forEach((cat) => {
    const ago = cat.lastUsed === 0 ? 'never' : `${Math.round((Date.now() - cat.lastUsed) / 60000)}m ago`;
    const count = candidates.filter((c) => c.category === cat.id).length;
    console.log(`   ${cat.id.padEnd(18)} last used: ${ago.padEnd(12)} candidates: ${count}`);
  });

  // Try each category in LRU order until we find one with a good candidate
  let winner = null;
  let winnerCategory = null;

  for (const cat of categoryOrder) {
    const pool = candidates
      .filter((c) => c.category === cat.id && c.score >= minScore)
      .sort((a, b) => b.jitteredScore - a.jitteredScore);

    if (pool.length > 0) {
      winner = pool[0];
      winnerCategory = cat.id;
      break;
    }
  }

  // Hard fallback: just take the globally best candidate
  if (!winner) {
    const fallback = candidates.filter((c) => c.score >= minScore).sort((a, b) => b.jitteredScore - a.jitteredScore)[0];
    if (!fallback) return null;
    winner = fallback;
    winnerCategory = fallback.category;
  }

  // Record this category as just used
  rotation.lastUsed[winnerCategory] = Date.now();
  saveRotation(rotation);

  const catLabel = CATEGORIES.find((c) => c.id === winnerCategory)?.label || winnerCategory;
  console.log(`\n🎯 Selected category: ${catLabel} (score: ${winner.score.toFixed(1)}, jittered: ${winner.jitteredScore.toFixed(1)})`);

  return winner;
}

module.exports = { categorize, selectWithRotation, CATEGORIES };
