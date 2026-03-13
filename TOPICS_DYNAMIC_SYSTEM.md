# Dynamic Topics System - How It Ensures Fresh Content

## Overview

The `topics_dynamic.json` file is **NOT hardcoded** and maintains a dynamic pool of topics that automatically refreshes. Here's how:

## Three Layers of Dynamicism

### 1. **Seed Topics** (Hardcoded - Baseline Only)
```javascript
const SEED_TOPICS = [
  'OpenAI', 'Claude', 'GPT-4', 'Llama', 'MistralAI', 'Anthropic',
  'ChatGPT', 'LangChain', 'Grok', 'DeepSeek', ...
  // 100+ hand-curated tools/models
];
```
- **Purpose**: Guaranteed baseline topics to fall back on
- **These stay constant** - they're the foundation
- **Used when**: Random selection & dynamic pool is exhausted

### 2. **Dynamic Discovered Pool** (Auto-Updated)
```javascript
// File: data/topics_dynamic.json
{
  "topics": [
    { "name": "Cursor", "addedAt": 1703001600000 },      // auto-discovered from HN
    { "name": "Vercel", "addedAt": 1703001600000 },      // from HF trending
    { "name": "LocalAI", "addedAt": 1702915200000 },     // 2+ days old
    ...
  ]
}
```

**How this stays dynamic:**
- **Discovery source 1**: Hacker News post titles
- **Discovery source 2**: HuggingFace trending models/spaces  
- **When**: Every time `publish.js` or `scheduler.js` runs
- **Recency**: Automatically expires after 7 days

### 3. **Automatic Cleanup** (Prevents Staleness)
```javascript
function loadDynamic() {
  // ... load topics_dynamic.json
  
  // Filter out topics older than 7 days
  const TOPIC_TTL_MS = 7 * 24 * 60 * 60 * 1000;  // 7 days
  const now = Date.now();
  const fresh = topics.filter(t => now - t.addedAt < TOPIC_TTL_MS);
  
  // If any expired, save cleaned file back (no accumulation!)
  if (fresh.length < original.length) {
    saveDynamic(fresh);
    console.log(`🗑️ Expired N stale topics, keeping M fresh ones`);
  }
  
  return fresh;
}
```

## Verification: How to Confirm It's Dynamic

Every time you run a publish/schedule cycle, you'll see logs like:

```
📰 Fetching news from 10 sources...
  ✓ RSS Feeds: 226 items
  ✓ Hacker News: 9 items
  ...
  💡 Dynamic topics updated: +3 new, 47 total active, file refreshed
    🗑️ Expired 2 stale topics (7+ days old), keeping 47 fresh ones
  🎯 Selected random topic: "Cursor" (auto-discovered from HN)
```

**Key signatures that it's working:**
- ✅ `+N new` topics added = new discoveries from HN/HF
- ✅ `🗑️ Expired M stale` = cleanup running
- ✅ `file refreshed` = topics_dynamic.json being updated
- ✅ `total active` = number keeps changing (not hardcoded)

## Why This Ensures Dynamicism

| Property | Implementation |
|----------|-----------------|
| **Not Hardcoded** | Only SEED_TOPICS are constants; dynamic pool is 100% discovered |
| **Stays Fresh** | 7-day TTL removes old entries automatically |
| **Grows** | Every publish adds new topics discovered from HN/HF |
| **No Accumulation** | Cleanup removes expired entries from disk |
| **Fallback Safe** | If dynamic pool empties, falls back to SEED_TOPICS |

## File Lifecycle

```
Day 1: Run publish
  → Discover: ["TopicA", "TopicB"]
  → Save: topics_dynamic.json with addedAt timestamps
  
Day 4: Run publish
  → Discover: ["TopicC", "TopicD"]  
  → Add to pool: ["TopicA", "TopicB", "TopicC", "TopicD"]
  → Save: Updated file
  
Day 8: Run publish
  → Load: ["TopicA", "TopicB", "TopicC", "TopicD", "TopicE", ...]
  → Filter: Remove "TopicA", "TopicB" (>7 days old)
  → Save: Cleaned file with only topics <7 days old
  → Add new: ["TopicF", "TopicG"]
  → Save: Updated file with fresh topics
```

## To Check Current State

```bash
# View current topics_dynamic.json
cat data/topics_dynamic.json | jq '.topics | length'

# See how many are fresh (< 7 days)
node -e "
const f = require('fs');
const data = JSON.parse(f.readFileSync('data/topics_dynamic.json'));
const now = Date.now();
const TTL = 7 * 24 * 60 * 60 * 1000;
const fresh = data.topics.filter(t => now - t.addedAt < TTL).length;
console.log(\`Fresh: \${fresh}, Total: \${data.topics.length}\`);
"

# Monitor in real-time
tail -f logs/*.log | grep -E "Dynamic|Expired|topic"
```

## Summary

✅ **topics_dynamic.json is always dynamic because:**
1. It's populated by auto-discovery from HN + HF every run
2. Topics expire after 7 days via TTL filtering  
3. Expired entries are automatically cleaned from disk
4. File gets updated with new discoveries each run
5. Only SEED_TOPICS are hardcoded (as a fallback)

**The system self-maintains freshness without any manual intervention.**
