/**
 * Core HTTP utility used by all source fetchers.
 * Handles redirects, timeouts, basic HTML-to-text stripping,
 * and sends a browser-like User-Agent to avoid 403s.
 */

const https = require('https');
const http  = require('http');

// Mimic a real browser to avoid 403 blocks on blog/news sites
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

function sanitizeUrl(url) {
  // Strip whitespace and control chars that make Node's http.get throw "Invalid URL"
  return url.trim().replace(/[\r\n\t]/g, '');
}

/**
 * Fetch a URL and return the response body as a string.
 * Follows up to 5 redirects. Times out after `timeoutMs`.
 */
function fetchUrl(rawUrl, timeoutMs = 10000, redirects = 5) {
  return new Promise((resolve, reject) => {
    if (redirects <= 0) return reject(new Error('Too many redirects'));

    const url = sanitizeUrl(rawUrl);
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      return reject(new Error(`Invalid URL: ${url}`));
    }

    const lib  = url.startsWith('https') ? https : http;
    const opts = {
      timeout: timeoutMs,
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml,application/rss+xml,application/atom+xml,*/*',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    };

    const req = lib.get(url, opts, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
        const next = res.headers.location.startsWith('http')
          ? res.headers.location
          : new URL(res.headers.location, url).href; // resolve relative redirects
        return fetchUrl(next, timeoutMs, redirects - 1).then(resolve).catch(reject);
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error(`Timeout fetching ${url}`)); });
  });
}

/**
 * Resolve a short URL (t.co, bit.ly, etc.) to its final destination.
 * Returns the original URL if resolution fails.
 */
function resolveUrl(rawUrl, timeoutMs = 6000) {
  return new Promise((resolve) => {
    try {
      const url = sanitizeUrl(rawUrl);
      const lib = url.startsWith('https') ? https : http;
      const req = lib.get(url, { timeout: timeoutMs, headers: { 'User-Agent': USER_AGENT } }, (res) => {
        req.destroy();
        const loc = res.headers.location;
        if ([301, 302, 307, 308].includes(res.statusCode) && loc) {
          const next = loc.startsWith('http') ? loc : new URL(loc, url).href;
          resolve(sanitizeUrl(next));
        } else {
          resolve(url);
        }
      });
      req.on('error', () => resolve(rawUrl));
      req.on('timeout', () => { req.destroy(); resolve(rawUrl); });
    } catch (_) {
      resolve(rawUrl);
    }
  });
}

/**
 * Strip HTML tags and collapse whitespace into readable plain text.
 */
function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g,  '&')
    .replace(/&lt;/g,   '<')
    .replace(/&gt;/g,   '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g,  "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

module.exports = { fetchUrl, resolveUrl, htmlToText };
