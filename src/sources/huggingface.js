/**
 * Hugging Face source — trending models and spaces.
 *
 * HF trending is where new tools surface before Twitter notices them.
 * API v2 uses sort=trendingScore&direction=-1 (not sort=trending).
 */

const { fetchUrl } = require('./fetch');

const HF_BASE = 'https://huggingface.co/api';

// Correct v2 query params — sort=trending returns 400, trendingScore works
const HF_API = {
  trendingModels: `${HF_BASE}/models?sort=trendingScore&direction=-1&limit=30&full=false`,
  trendingSpaces: `${HF_BASE}/spaces?sort=trendingScore&direction=-1&limit=30&full=false`,
};

const USEFUL_TAGS = [
  'text-generation', 'text2text-generation', 'conversational',
  'question-answering', 'summarization', 'code', 'chat',
  'instruction', 'agent', 'tool-use', 'vision', 'multimodal',
  'image-to-text', 'visual-question-answering',
];

function isUsefulModel(model) {
  const tags = (model.tags || []).map((t) => t.toLowerCase());
  return USEFUL_TAGS.some((t) => tags.some((tag) => tag.includes(t)));
}

function modelToItem(model) {
  const name      = model.modelId || model.id || 'unknown';
  const likes     = model.likes || 0;
  const downloads = model.downloads || 0;
  const tags      = (model.tags || []).slice(0, 6).join(', ');

  return {
    text:        `Trending on Hugging Face: ${name}. ${likes} likes, ${downloads.toLocaleString()} downloads.${tags ? ` Tags: ${tags}.` : ''}`,
    title:       name,
    url:         `https://huggingface.co/${name}`,
    pubDate:     model.lastModified ? new Date(model.lastModified) : null,
    source:      'HuggingFace Trending',
    sourceTier:  2,
    hfLikes:     likes,
    hfDownloads: downloads,
  };
}

function spaceToItem(space) {
  const name  = space.id || 'unknown';
  const likes = space.likes || 0;
  const title = space.cardData?.title || name;
  const desc  = space.cardData?.short_description || '';

  return {
    text:       `Trending HuggingFace Space: ${title} (${name}).${desc ? ` ${desc}.` : ''} ${likes} likes.`,
    title,
    url:        `https://huggingface.co/spaces/${name}`,
    pubDate:    space.lastModified ? new Date(space.lastModified) : null,
    source:     'HuggingFace Spaces',
    sourceTier: 2,
    hfLikes:    likes,
  };
}

async function fetchHuggingFace() {
  console.log('\n🤗 Fetching HuggingFace trending...');
  const results      = [];
  const trendingNames = [];

  // Trending models
  try {
    const raw    = await fetchUrl(HF_API.trendingModels, 10000);
    const models = JSON.parse(raw);
    const useful = models.filter(isUsefulModel);
    useful.forEach((m) => {
      results.push(modelToItem(m));
      const shortName = (m.modelId || m.id || '').split('/').pop();
      if (shortName && shortName.length > 3) trendingNames.push(shortName);
    });
    console.log(`  ✓ Trending models: ${useful.length} useful (of ${models.length})`);
  } catch (err) {
    console.warn(`  ✗ HF models: ${err.message}`);
  }

  // Trending spaces
  try {
    const raw    = await fetchUrl(HF_API.trendingSpaces, 10000);
    const spaces = JSON.parse(raw);
    spaces.slice(0, 20).forEach((s) => {
      results.push(spaceToItem(s));
      const shortName = (s.id || '').split('/').pop();
      if (shortName && shortName.length > 3) trendingNames.push(shortName);
    });
    console.log(`  ✓ Trending spaces: ${Math.min(spaces.length, 20)}`);
  } catch (err) {
    console.warn(`  ✗ HF spaces: ${err.message}`);
  }

  return { items: results, trendingNames };
}

module.exports = { fetchHuggingFace };
