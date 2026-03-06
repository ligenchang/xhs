/**
 * Dynamic topic pool for Twitter search.
 *
 * Two layers:
 *   1. SEED_TOPICS — stable, hand-curated list of known tools/labs/models
 *   2. Dynamic pool — names discovered from HuggingFace trending and HN,
 *      stored in data/topics_dynamic.json with a 7-day TTL.
 */

const fs   = require('fs');
const path = require('path');

const DYNAMIC_FILE = path.resolve('./data/topics_dynamic.json');
const TOPIC_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_DYNAMIC  = 500;  // Increased from 200 to allow more discovered topics


// ─── Seed topics ──────────────────────────────────────────────────────────────

const SEED_TOPICS = [
  // Major labs & companies
  'OpenAI', 'Anthropic', 'Google DeepMind', 'Meta AI', 'xAI Grok', 'Mistral AI',
  'Cohere AI', 'AI21 Labs', 'Stability AI', 'Together AI', 'Perplexity AI',
  'Runway AI', 'Midjourney', 'ElevenLabs', 'Hugging Face', '00 Metrics',
  
  // Frontier models
  'GPT-5', 'GPT-4o', 'o3 model', 'Claude 4', 'Claude 3.7', 'Gemini 2.5',
  'Llama 4', 'DeepSeek V3', 'DeepSeek R2', 'Grok 3', 'Qwen 3', 'Phi-4',
  'Mistral Small 3', 'Command R+', 'Gemma 3', 'Falcon LLM', 'Bloom model',
  
  // Coding & development tools
  'Claude Code', 'Cursor AI', 'Windsurf AI', 'Devin AI', 'GitHub Copilot',
  'Replit AI', 'Codeium', 'Aider coding', 'Zed AI', 'Cline AI', 'Continue dev',
  'Copilot Pro', 'Amazon CodeWhisperer', 'TabNine', 'Ghostwriter',
  
  // Agents & productivity
  'Manus AI agent', 'Perplexity AI Search', 'Notion AI', 'v0 Vercel', 'Bolt new AI',
  'Lovable AI', 'Dify workflow', 'n8n automation', 'Flowise AI', 'OpenHands AI',
  'Relevance AI', 'Langflow agent', 'Composio API',
  
  // AI reasoning & research
  'AI reasoning models', 'inference scaling', 'chain of thought', 'test time compute',
  'AI multimodal', 'vision language models', 'RAG systems', 'knowledge graphs',
  'AI alignment research', 'mechanistic interpretability', 'AI safety benchmarks',
  'prompt engineering', 'few shot learning', 'in context learning',
  
  // Infrastructure & deployment
  'Groq LPU', 'OpenRouter API', 'RunPod GPU', 'Lambda Labs', 'Modal Labs',
  'Vercel AI SDK', 'Anthropic API', 'OpenAI API', 'Replicate API', 'Hugging Face API',
  'vLLM inference', 'Ray LLM', 'Ollama local', 'LocalAI', 'GPT4All',
  'GGML quantization', 'TensorFlow Lite', 'ONNX Runtime', 'TVM compiler',
  
  // Frameworks & platforms
  'LangChain', 'LangGraph', 'LlamaIndex', 'CrewAI', 'AutoGen', 'PydanticAI',
  'Vercel AI', 'Preline AI', 'Reflex framework', 'Streamlit AI', 'Gradio',
  'FastAPI LLM', 'Django Ninja', 'LiteLLM', 'LLM Router',
  
  // Protocols & standards
  'MCP protocol', 'Model Context Protocol', 'function calling API', 'tool use',
  'OpenAI plugins', 'Anthropic tools', 'Claude extensions',
  
  // Industry applications
  'AI healthcare', 'AI education platform', 'AI customer service', 'AI analytics',
  'AI content generation', 'AI video synthesis', 'AI music generation',
  'AI trading bot', 'AI recruitment', 'AI legal assistant',
  
  // Emerging areas
  'AI multimodal retrieval', 'AI graph neural networks', 'AI diffusion models',
  'AI semantic search', 'AI vector databases', 'AI knowledge distillation',
  'federated learning', 'differential privacy AI', 'AI model compression',
  'continual learning AI', 'meta-learning', 'transfer learning',
  
  // Developer tools
  'Supabase AI', 'Firebase Genkit', 'AWS Bedrock', 'Azure OpenAI',
  'Google Cloud Vertex', 'IBM Watsonx', 'Oracle AI', 'SageMaker',
  'Hugging Face Spaces', 'GitHub Copilot Enterprise', 'JetBrains AI',
  
  // Data & RAG
  'Vector database', 'Pinecone', 'Weaviate', 'Qdrant', 'Milvus',
  'ChromaDB', 'Postgres vector', 'Elasticsearch', 'Algolia AI',
  'embedding models', 'reranking models', 'document parsing AI',
  
  // Monitoring & evaluation
  'LLM evaluation', 'prompt testing', 'AI observability', 'Langfuse',
  'Weights Biases', 'Arize AI monitoring', 'Arthur AI governance',
  'AI fairness metrics', 'toxicity detection', 'bias testing',
];

// Common English words that match our patterns but are not tool names
const COMMON_WORDS = new Set([
  'This', 'That', 'With', 'From', 'When', 'Then', 'They', 'Their',
  'Have', 'Been', 'Will', 'Would', 'Could', 'Should', 'The', 'And',
  'For', 'But', 'Not', 'You', 'All', 'Can', 'Her', 'Was', 'One',
  'Our', 'Out', 'Day', 'Get', 'Has', 'Him', 'His', 'How', 'Its',
  'Now', 'Old', 'See', 'Two', 'Way', 'Who', 'Any', 'New', 'May',
  'Use', 'She', 'Each', 'Much', 'More', 'Also', 'Into', 'Most',
  'What', 'Some', 'Such', 'Only', 'Over', 'Same', 'Even', 'Because',
  'After', 'First', 'Never', 'These', 'Think', 'Where', 'While',
  'Those', 'Still', 'Every', 'Found', 'Since', 'Large', 'Often',
  'Something', 'Everything', 'Nothing', 'Anything', 'Someone',
  'Today', 'Friday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday',
  'January', 'February', 'March', 'April', 'June', 'July', 'August',
  'September', 'October', 'November', 'December',
  // Generic tech words that aren't useful search topics on their own
  'System', 'Model', 'Using', 'Based', 'Training', 'Learning', 'Neural',
  'Data', 'Code', 'Time', 'High', 'Large', 'Small', 'Fast', 'Best',
  'Meta', 'Alpha', 'Beta', 'Delta', 'Gamma', 'Sigma', 'Omega',
  'Pro', 'Plus', 'Max', 'Ultra', 'Super', 'Micro', 'Nano',
]);

// ─── Dynamic pool ─────────────────────────────────────────────────────────────

function loadDynamic() {
  try {
    if (fs.existsSync(DYNAMIC_FILE)) {
      const data = JSON.parse(fs.readFileSync(DYNAMIC_FILE, 'utf-8'));
      const now  = Date.now();
      return (data.topics || []).filter((t) => now - (t.addedAt || 0) < TOPIC_TTL_MS);
    }
  } catch (_) {}
  return [];
}

function saveDynamic(topics) {
  try {
    fs.mkdirSync(path.dirname(DYNAMIC_FILE), { recursive: true });
    fs.writeFileSync(DYNAMIC_FILE, JSON.stringify({ topics, updatedAt: new Date().toISOString() }, null, 2));
  } catch (_) {}
}

function addDiscoveredTopics(names) {
  const existing = loadDynamic();
  const existingNames = new Set([
    ...SEED_TOPICS.map((t) => t.toLowerCase()),
    ...existing.map((t) => t.name.toLowerCase()),
  ]);

  const newEntries = names
    .filter((name) => {
      if (!name || name.length < 5 || name.length > 40) return false;
      if (COMMON_WORDS.has(name)) return false;
      if (existingNames.has(name.toLowerCase())) return false;
      // Must look like a product/tool name: contains a digit, hyphen, or
      // is CamelCase, or ends with known AI suffixes
      const looksLikeTool = /\d/.test(name)
        || /[A-Z][a-z]+[A-Z]/.test(name)        // CamelCase
        || /-/.test(name)                        // hyphenated
        || /\b(AI|LLM|GPT|API|SDK|CLI)\b/.test(name); // known suffixes
      return looksLikeTool;
    })
    .map((name) => ({ name, addedAt: Date.now() }));

  if (newEntries.length > 0) {
    const merged = [...existing, ...newEntries].slice(-MAX_DYNAMIC);
    saveDynamic(merged);
    console.log(`  💡 Added ${newEntries.length} dynamic topics: ${newEntries.slice(0, 5).map((t) => t.name).join(', ')}${newEntries.length > 5 ? '...' : ''}`);
  }
}

/**
 * Extract potential tool/model names from fetched content.
 * Aggressive extraction to catch emerging tools early — includes GitHub repos,
 * Product Hunt mentions, and launch announcement patterns.
 */
function extractTopicsFromText(text) {
  const discovered = new Set();

  // CamelCase product names: LangGraph, OpenClaw, LlamaIndex
  const camelRe = /\b([A-Z][a-z]+(?:[A-Z][a-z]+)+)\b/g;
  // Model version names: GPT-4o, Claude-3.7, Llama-4, Qwen2.5
  const versionRe = /\b([A-Z][a-zA-Z]{2,}-?[\d.]+[a-z]?)\b/g;
  // "Name AI/LLM/API" patterns: "Cursor AI", "Groq API"
  const suffixRe = /\b([A-Z][a-zA-Z]{3,}\s(?:AI|LLM|API|SDK|CLI|Pro|Plus|Max|Ultra))\b/g;
  // GitHub repository names from links: owner/tool-name → extract tool-name
  const githubRe = /github\.com\/[\w-]+\/([\w-]+)/gi;
  // Launched/announced tool mention patterns: "X launches Y", "Introducing Z"
  const launchPatternRe = /(?:launches?|announce|introduce|ship|debut|release|open[- ]source)\s+([A-Z][a-zA-Z0-9-]*)/gi;
  // Product Hunt style: "HN/PH: Tool Name"
  const productHuntRe = /\b([A-Z][a-zA-Z0-9-]*)\s+(?:on ProductHunt|on Product Hunt|on PH|YC-backed)\b/gi;

  for (const re of [camelRe, versionRe, suffixRe, githubRe, launchPatternRe, productHuntRe]) {
    let m;
    while ((m = re.exec(text)) !== null) {
      const name = (m[1] || m[0]).trim();
      // Clean up GitHub URLs
      const cleaned = name.replace(/[\/\-]*$/, '').replace(/^github\.com\/[\w-]+\//, '');
      if (cleaned && !COMMON_WORDS.has(cleaned) && cleaned.length >= 3 && cleaned.length <= 40) {
        discovered.add(cleaned);
      }
    }
  }

  return [...discovered];
}

function getAllTopics() {
  const dynamic         = loadDynamic().map((t) => t.name);
  const dynamicShuffled = dynamic.sort(() => Math.random() - 0.5);
  return [...SEED_TOPICS, ...dynamicShuffled];
}

module.exports = { getAllTopics, addDiscoveredTopics, extractTopicsFromText, SEED_TOPICS };
