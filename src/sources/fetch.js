/**
 * Core HTTP utility used by all source fetchers.
 * Handles redirects, timeouts, basic HTML-to-text stripping,
 * PDF text extraction, and sends a browser-like User-Agent to avoid 403s.
 */

const https = require('https');
const http  = require('http');

// Try to load pdf-parse if available, otherwise use fallback
let pdfParse;
try {
  pdfParse = require('pdf-parse');
} catch (_) {
  pdfParse = null;
}

// Mimic a real browser to avoid 403 blocks on blog/news sites
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

function sanitizeUrl(url) {
  // Strip whitespace and control chars that make Node's http.get throw "Invalid URL"
  return url.trim().replace(/[\r\n\t]/g, '');
}

/**
 * Fetch a URL and return the response body as a string.
 * Handles both HTML and PDF files.
 * Follows up to 5 redirects. Times out after `timeoutMs`.
 */
function fetchUrl(rawUrl, timeoutMs = 10000, redirects = 5, isPdf = null) {
  return new Promise((resolve, reject) => {
    if (redirects <= 0) return reject(new Error('Too many redirects'));

    const url = sanitizeUrl(rawUrl);
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      return reject(new Error(`Invalid URL: ${url}`));
    }

    // Auto-detect PDF if not specified
    if (isPdf === null) {
      isPdf = isPdfUrl(url);
    }

    const lib  = url.startsWith('https') ? https : http;
    const opts = {
      timeout: timeoutMs,
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml,application/pdf,application/rss+xml,application/atom+xml,*/*',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    };

    const req = lib.get(url, opts, async (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
        const next = res.headers.location.startsWith('http')
          ? res.headers.location
          : new URL(res.headers.location, url).href;
        return fetchUrl(next, timeoutMs, redirects - 1, isPdf).then(resolve).catch(reject);
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      
      // Handle binary data for PDFs
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', async () => {
        try {
          const data = Buffer.concat(chunks);
          
          if (isPdf) {
            // Extract text from PDF
            const text = await extractPdfText(data);
            resolve(text);
          } else {
            // Return HTML as string
            resolve(data.toString('utf8'));
          }
        } catch (err) {
          reject(err);
        }
      });
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

/**
 * Extract text from PDF buffer using pdf-parse if available.
 * Falls back to regex-based text extraction if library not available.
 */
async function extractPdfText(pdfBuffer) {
  // Try with pdf-parse library if available
  if (pdfParse) {
    try {
      const data = await pdfParse(pdfBuffer);
      const text = data.text || '';
      return text.trim();
    } catch (err) {
      console.log(`  ⚠️ pdf-parse failed: ${err.message}, trying fallback extraction...`);
    }
  }

  // Fallback: extract readable text strings from PDF
  try {
    let text = pdfBuffer.toString('binary');
    
    // Extract text from PDF text objects patterns like:
    // (text content) Tj  or  (text)' or (text)"
    const textPatterns = [
      /\(([^()\\]*(?:\\.[^()\\]*)*)\)\s*(?:Tj|TJ|\'|\")/g,  // Text show operators
      /BT\s*([\s\S]*?)\s*ET/g,  // Text blocks
    ];
    
    let extractedText = '';
    
    for (const pattern of textPatterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        let str = match[1] || '';
        
        // Decode PDF escape sequences
        str = str.replace(/\\n/g, '\n');
        str = str.replace(/\\r/g, '\r');
        str = str.replace(/\\t/g, '\t');
        str = str.replace(/\\\(/g, '(');
        str = str.replace(/\\\)/g, ')');
        str = str.replace(/\\\\/g, '\\');
        str = str.replace(/\\(.)/g, '$1');  // Remove unknown escapes
        
        // Only keep printable ASCII and common punctuation
        if (str.length > 1 && /[a-zA-Z0-9\s\-.,;:'"]/.test(str)) {
          extractedText += str + ' ';
        }
      }
    }
    
    if (extractedText.trim().length > 100) {
      // Clean up whitespace
      return extractedText
        .replace(/\s+/g, ' ')
        .trim();
    }
    
    // If text patterns didn't work, try to extract any readable ASCII
    console.log(`  ⚠️ Standard PDF text extraction found minimal content, attempting ASCII extraction...`);
    const ascii = pdfBuffer
      .toString('binary')
      .replace(/[^\x20-\x7E\n\r\t]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    
    if (ascii.length > 200) {
      return ascii.substring(0, 4000);
    }
    
    return '';
  } catch (err) {
    console.log(`  ⚠️ Fallback PDF extraction failed: ${err.message}`);
    return '';
  }
}

/**
 * Check if a URL or content is a PDF
 */
function isPdfUrl(url) {
  return /\.pdf(\?|$)/i.test(url);
}

module.exports = { fetchUrl, resolveUrl, htmlToText, extractPdfText, isPdfUrl };
