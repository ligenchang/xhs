# PDF Support Setup Guide

## Overview
The XHS Auto Publisher now supports PDF documents alongside HTML web pages. You can use arXiv papers, research PDFs, and other documents directly as sources.

## Installation

### Option 1: Recommended - Install pdf-parse (Best Quality)
For reliable, high-quality PDF text extraction:

```bash
npm install pdf-parse
```

**Benefits:**
- ✅ Handles compressed PDF streams correctly
- ✅ Extracts text from complex PDFs
- ✅ Supports modern PDF features
- ✅ No loss of content quality

### Option 2: Use Built-in Fallback (No Extra Dependencies)
If you don't want to install dependencies, the system includes a basic PDF text extractor:
- Works with simple PDFs
- Text-based PDFs only (not scanned images)
- May miss content in compressed streams

## Usage Examples

### Single PDF from arXiv
```bash
node index.js url https://arxiv.org/pdf/2509.14185
```

### Multiple URLs (mix HTML + PDF)
```bash
node index.js url \
  https://deepmind.google/blog/discovering-new-solutions... \
  https://arxiv.org/pdf/2509.14185 \
  https://github.com/example/repo
```

### Multiple PDFs
```bash
node index.js url \
  https://arxiv.org/pdf/2501.01234 \
  https://arxiv.org/pdf/2501.01235 \
  https://example.com/research.pdf
```

## Troubleshooting

### Problem: PDF Extraction Returns Garbled Content
**Solution:** Install pdf-parse
```bash
npm install pdf-parse
```

### Problem: "Content too short" error for PDFs
**Cause:** The PDF could not be parsed properly
**Solution:** 
1. Try installing pdf-parse: `npm install pdf-parse`
2. If still failing, the PDF may be:
   - A scanned image without OCR
   - Encrypted/password protected
   - Corrupted

### Verify Installation
```bash
npm list pdf-parse
```

If installed correctly, you'll see:
```
└── pdf-parse@1.x.x
```

## How It Works

### With pdf-parse installed:
```
URL → Fetch PDF → Parse with pdf-parse → Extract clean text → Generate post
```

### Without pdf-parse (fallback):
```
URL → Fetch PDF → Regex text extraction → Extract readable content → Generate post
```

The system automatically chooses the best method available.

## Supported PDF Sources
- ✅ arXiv papers (https://arxiv.org/pdf/...)
- ✅ Research PDFs (IEEE, ACM, etc.)
- ✅ Technical whitepapers
- ✅ Blog PDFs
- ✅ Most text-based PDFs

## Not Supported
- ❌ Scanned PDFs without OCR
- ❌ Encrypted/password-protected PDFs
- ❌ PDF images without text layer

## Quick Start

1. **Install pdf-parse** (recommended):
   ```bash
   npm install pdf-parse
   ```

2. **Test with an arXiv paper**:
   ```bash
   node index.js url https://arxiv.org/pdf/2509.14185
   ```

3. **Check help for more examples**:
   ```bash
   node index.js --help
   ```

## Questions?
Check the main README.md for general setup and usage details.
