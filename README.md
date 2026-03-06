# XHS Auto Publisher

Fetches trending AI news from multiple sources, translates with AI, and publishes to Xiaohongshu automatically.

## Setup

```bash
npm install
npx playwright install chromium
cp .env.example .env   # fill in your keys
```

**.env**
```
NVIDIA_API_KEY=your_key
AUTH_TOKEN=your_twitter_token   # optional
CT0=your_twitter_ct0            # optional
```

## Usage

```bash
node index.js           # publish one post (default)
node index.js schedule  # auto-publish every 20–40 min
node index.js stats     # show published count
node index.js reset     # clear published history
```

## How it works

Each run fetches from all sources in parallel, scores every candidate, enriches the winner with its full article, then generates a Chinese post.

```
Sources (parallel fetch)
  ├── RSS feeds          Official lab blogs (Anthropic, OpenAI, DeepMind, Meta, Mistral,
  │                      HuggingFace, LangChain) + TechCrunch, The Verge, VentureBeat,
  │                      Ars Technica, MIT Tech Review, The Register
  ├── Hacker News        Top AI stories with 50+ community points (free API, no auth)
  ├── arXiv              Daily papers from cs.AI, cs.LG, cs.CL
  ├── HuggingFace        Trending models + Spaces (catches new tools before Twitter does)
  └── Twitter            bird CLI search across full topic pool (seeds + dynamic)
        │
        └── Dynamic topic pool (data/topics_dynamic.json)
              Seeds: ~60 known tools/labs/models
              Dynamic: names discovered from HF trending + HN, 7-day TTL

Winner selected by score
  ├── Source tier bonus  (+8 official blog/paper, +3 HN/news outlet)
  ├── HN community score (+up to 8 pts based on upvotes)
  ├── Breaking news      (+12 major lab + breaking verb)
  ├── Named tool bonus   (+3 per known tool mentioned)
  ├── Technical signals  (+1.5 each: benchmark, inference, agent, RAG, etc.)
  ├── Data richness      (+up to 7 pts for numbers/stats)
  └── Freshness          (×1.5 <2h, ×1.2 <6h, ×0.8 >24h, ×0.6 >72h)

Full article fetch
  Top 5 candidates → resolve redirect → fetch full page → extract main content
  Blocked: Twitter, paywalled sites (NYT, WSJ, Bloomberg, etc.)

AI generation (NVIDIA nemotron-3-nano-30b-a3b)
  Input:  structured bundle — signal + full article + source metadata
  Output: Chinese Xiaohongshu post (title + 1000–1800 char body + hashtags)
  Handles reasoning models: streams reasoning_content for display,
  uses only content field for the post; falls back if content is empty.
```

## Project structure

```
index.js              CLI entry point
src/
  config.js           env vars & constants
  store.js            published-hash deduplication
  topics.js           seed + dynamic topic pool
  news.js             orchestrates all sources → enriched bundle
  prompts.js          AI prompts (English, for model accuracy)
  generator.js        AI content generation
  browser.js          Playwright browser automation
  publish.js          pipeline: news → generate → publish
  scheduler.js        random-interval loop
  sources/
    fetch.js          shared HTTP utility (redirects, HTML stripping)
    rss.js            RSS/Atom feed parser (13 feeds)
    hackernews.js     Hacker News API
    arxiv.js          arXiv RSS (cs.AI, cs.LG, cs.CL)
    huggingface.js    HuggingFace trending models + spaces
    article.js        full-article fetcher + enrichment
data/
  published_news.json   persisted hash store (auto-created)
  topics_dynamic.json   dynamic topic pool (auto-created)
```
