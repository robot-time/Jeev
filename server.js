'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
const PORT = 7429;

app.use(cors());
app.use(express.json());

// Serve the newtab page and its assets from HTTP so the page can call
// /search with same-origin (no CORS required from the webview side).
const path = require('path');
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'newtab.html')));
app.get('/newtab.html', (_req, res) => res.sendFile(path.join(__dirname, 'newtab.html')));
app.get('/newtab.js', (_req, res) => res.sendFile(path.join(__dirname, 'newtab.js')));
app.get('/newtab.css', (_req, res) => res.sendFile(path.join(__dirname, 'newtab.css')));

// ===================== IN-MEMORY CACHE =====================
const pageCache = new Map(); // url -> { text, title, timestamp }
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

function getCached(url) {
  const entry = pageCache.get(url);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL) { pageCache.delete(url); return null; }
  return entry;
}

function setCache(url, data) {
  pageCache.set(url, { ...data, timestamp: Date.now() });
}

// ===================== TEXT EXTRACTION =====================
function extractText(html) {
  // Extract <title>
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  const title = titleMatch ? decodeHtmlEntities(titleMatch[1].trim()) : '';

  // Remove entire blocks we don't want
  let body = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<canvas[\s\S]*?<\/canvas>/gi, ' ')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<header[\s\S]*?<\/header>/gi, ' ')
    .replace(/<aside[\s\S]*?<\/aside>/gi, ' ');

  // Try to narrow to main content area
  const mainMatch = body.match(/<(?:main|article)[^>]*>([\s\S]*?)<\/(?:main|article)>/i);
  if (mainMatch && mainMatch[1].length > 500) body = mainMatch[1];

  // Strip all remaining HTML tags
  let text = body.replace(/<[^>]+>/g, ' ');

  // Decode entities
  text = decodeHtmlEntities(text);

  // Normalize whitespace
  text = text
    .replace(/\t/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\s+|\s+$/gm, '')
    .trim();

  return { text, title };
}

function decodeHtmlEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

// ===================== TEXT CHUNKING =====================
function chunkText(text) {
  // Split into sentences
  const sentenceRe = /[^.!?…]+(?:[.!?…]+(?:\s|$)|$)/g;
  const sentences = [];
  let m;
  while ((m = sentenceRe.exec(text)) !== null) {
    const s = m[0].trim();
    if (s.split(/\s+/).length >= 4) sentences.push(s);
  }

  if (sentences.length === 0) {
    // Fallback: split by newlines
    return text.split(/\n+/).map(s => s.trim()).filter(s => s.split(/\s+/).length >= 10);
  }

  // Group sentences into chunks of ~100–180 words
  const chunks = [];
  let current = [];
  let wordCount = 0;

  for (const sentence of sentences) {
    const words = sentence.split(/\s+/).length;
    if (wordCount + words > 180 && current.length > 0) {
      chunks.push(current.join(' '));
      // Overlap: keep last sentence for context
      current = [current[current.length - 1], sentence];
      wordCount = current.join(' ').split(/\s+/).length;
    } else {
      current.push(sentence);
      wordCount += words;
      if (wordCount >= 80 && current.length >= 2) {
        chunks.push(current.join(' '));
        current = [current[current.length - 1]];
        wordCount = current[0].split(/\s+/).length;
      }
    }
  }
  if (current.length > 0 && current.join(' ').split(/\s+/).length >= 15) {
    chunks.push(current.join(' '));
  }

  return chunks.filter(c => c.split(/\s+/).length >= 15);
}

// ===================== TF-IDF SCORING =====================
const STOP_WORDS = new Set([
  'the', 'is', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'up', 'about', 'into', 'through', 'during',
  'before', 'after', 'above', 'below', 'between', 'out', 'off', 'over',
  'under', 'again', 'then', 'once', 'here', 'there', 'when', 'where', 'why',
  'how', 'all', 'both', 'each', 'few', 'more', 'most', 'other', 'some',
  'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too',
  'very', 'can', 'will', 'just', 'should', 'would', 'could', 'may', 'might',
  'that', 'this', 'these', 'those', 'what', 'which', 'who', 'does', 'did',
  'was', 'were', 'are', 'be', 'been', 'being', 'have', 'has', 'had', 'do',
  'its', 'their', 'our', 'your', 'his', 'her', 'my', 'we', 'they', 'he',
  'she', 'it', 'i', 'you', 'also', 'as', 'if', 'while', 'although', 'because',
]);

function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1 && !STOP_WORDS.has(w));
}

function scoreChunks(chunks, queryText) {
  const queryTokens = tokenize(queryText);
  if (queryTokens.length === 0) return chunks.map(c => ({ chunk: c, score: 0 }));

  const N = chunks.length;
  if (N === 0) return [];

  // Document frequency per query token
  const df = {};
  const chunkTokenSets = chunks.map(chunk => {
    const tokens = new Set(tokenize(chunk));
    for (const qt of queryTokens) {
      if (tokens.has(qt)) df[qt] = (df[qt] || 0) + 1;
    }
    return tokens;
  });

  // IDF
  const idf = {};
  for (const qt of queryTokens) {
    idf[qt] = Math.log((N + 1) / ((df[qt] || 0) + 1)) + 1;
  }

  return chunks.map((chunk, i) => {
    const chunkTokens = tokenize(chunk);
    const tokenFreq = {};
    for (const t of chunkTokens) tokenFreq[t] = (tokenFreq[t] || 0) + 1;

    let score = 0;
    for (const qt of queryTokens) {
      const tf = (tokenFreq[qt] || 0) / Math.max(chunkTokens.length, 1);
      score += tf * idf[qt];
    }

    // Boost: exact phrase match
    const chunkLower = chunk.toLowerCase();
    const queryLower = queryText.toLowerCase();
    if (chunkLower.includes(queryLower)) score *= 3.0;

    // Boost: all query tokens present
    const presentCount = queryTokens.filter(qt => chunkTokenSets[i].has(qt)).length;
    const coverage = presentCount / queryTokens.length;
    score *= (0.5 + coverage * 0.8);

    // Slight penalty for very short chunks
    const wordCount = chunkTokens.length;
    if (wordCount < 30) score *= 0.6;

    return { chunk, score };
  });
}

// ===================== PAGE FETCHING =====================
async function fetchPage(url) {
  const cached = getCached(url);
  if (cached) return cached;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    clearTimeout(timeout);

    if (!resp.ok) return null;
    const contentType = resp.headers.get('content-type') || '';
    if (!contentType.includes('text/html') && !contentType.includes('text/plain')) return null;

    const html = await resp.text();
    const extracted = extractText(html);
    setCache(url, extracted);
    return extracted;
  } catch (e) {
    clearTimeout(timeout);
    return null;
  }
}

// ===================== BRAVE SEARCH =====================
async function braveSearch(query) {
  const key = process.env.BRAVE_API_KEY;
  if (!key) throw new Error('BRAVE_API_KEY not set. Add it to your .env file.');

  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=8&search_lang=en&extra_snippets=1`;
  const resp = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'Accept-Encoding': 'gzip',
      'X-Subscription-Token': key,
    },
    signal: AbortSignal.timeout(8000),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`Brave Search API error ${resp.status}: ${body.slice(0, 200)}`);
  }

  const data = await resp.json();
  const results = (data.web && data.web.results) || [];

  return results.map(r => ({
    url: r.url,
    title: r.title || r.url,
    description: r.description || '',
    extraSnippets: r.extra_snippets || [],
  }));
}

// ===================== MAIN SEARCH ENDPOINT =====================
app.get('/search', async (req, res) => {
  const query = (req.query.q || '').trim();
  if (!query) return res.status(400).json({ error: 'Query parameter q is required.' });

  try {
    // 1. Get search results from Brave
    let sources;
    try {
      sources = await braveSearch(query);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }

    if (!sources || sources.length === 0) {
      return res.json({ result: null, sources: [], message: 'No search results found.' });
    }

    // 2. Collect Brave's own curated text — descriptions + extra_snippets
    // Require at least 12 words to filter out image alt text and navigation fragments
    const minWords = 12;
    const isUsable = (text) => text && text.split(/\s+/).length >= minWords;
    const candidates = [];
    for (const s of sources) {
      if (isUsable(s.description)) {
        candidates.push({ chunk: s.description, url: s.url, title: s.title });
      }
      for (const snip of (s.extraSnippets || [])) {
        if (isUsable(snip)) {
          candidates.push({ chunk: snip, url: s.url, title: s.title });
        }
      }
    }

    // 3. Also attempt page fetches in parallel (best effort, 3s per page)
    const pageResults = await Promise.allSettled(
      sources.slice(0, 5).map(s => fetchPage(s.url).then(data => data ? { ...data, url: s.url, title: s.title } : null))
    );
    for (const pr of pageResults) {
      if (pr.status !== 'fulfilled' || !pr.value) continue;
      const { text, title, url } = pr.value;
      if (!text || text.length < 100) continue;
      for (const chunk of chunkText(text)) {
        candidates.push({ chunk, url, title });
      }
    }

    if (candidates.length === 0) {
      return res.json({ result: null, sources, message: 'Could not extract text from any result pages.' });
    }

    // 4. Score all candidates together
    const scored = scoreChunks(candidates.map(c => c.chunk), query)
      .map((s, i) => ({ ...s, ...candidates[i] }))
      .sort((a, b) => b.score - a.score);

    const best = scored[0];
    if (!best || best.score === 0) {
      // Fall back to the longest candidate (most informative)
      const fallback = candidates.reduce((a, b) => b.chunk.length > a.chunk.length ? b : a, candidates[0]);
      return res.json({ result: fallback.chunk, sourceUrl: fallback.url, sourceTitle: fallback.title, score: 0, sources });
    }

    return res.json({
      result: best.chunk,
      sourceUrl: best.url,
      sourceTitle: best.title,
      score: best.score,
      sources,
    });

  } catch (e) {
    console.error('Search error:', e);
    return res.status(500).json({ error: e.message || 'Internal server error' });
  }
});

// ===================== HEALTH CHECK =====================
app.get('/health', (_req, res) => res.json({ ok: true }));

// ===================== START =====================
app.listen(PORT, '127.0.0.1', () => {
  console.log(`Search server running on http://127.0.0.1:${PORT}`);
});
