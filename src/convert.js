#!/usr/bin/env node
/**
 * Convert a document to RTL-aware Markdown and/or a standalone HTML document.
 *
 * Usage:
 *   node convert.js <input-file> [--format md|html|both] [--out-dir <dir>]
 *
 * Defaults to --format both.
 */

const path = require('path');
const fs = require('fs');
const { addRtlSupport, detectVisualOrder } = require('./rtl');
const { renderHtml } = require('./render-html');

function parseArgs(argv) {
  const args = { format: 'both', outDir: null, input: null, force: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--format') args.format = argv[++i];
    else if (argv[i] === '--out-dir') args.outDir = argv[++i];
    else if (argv[i] === '--force') args.force = true;
    else if (!args.input) args.input = argv[i];
  }
  return args;
}

async function toMarkdown(inputPath) {
  const ext = path.extname(inputPath).toLowerCase();

  // Text input needs no conversion — go straight to RTL post-processing. anydoc
  // rejects .txt outright, and plain text is the one thing it never needs to parse.
  if (['.md', '.markdown', '.txt'].includes(ext)) {
    return fs.readFileSync(inputPath, 'utf8');
  }

  // anydoc extracts PDF text in visual order, which scrambles Hebrew and Arabic
  // beyond repair. pdf.js returns logical order, so PDFs go through it instead.
  if (ext === '.pdf') {
    const { pdfToMarkdown } = require('./pdf-extract');
    return pdfToMarkdown(inputPath);
  }

  // anydoc flattens a deck into one continuous run, losing slide boundaries.
  if (ext === '.pptx') {
    const { pptxToMarkdown } = require('./pptx-extract');
    return pptxToMarkdown(inputPath);
  }

  let toMarkdown;
  try {
    ({ toMarkdown } = require('@firecrawl/anydoc'));
  } catch {
    throw new Error(
      `Converting ${ext} requires anydoc. Install it with:\n\n  npm install @firecrawl/anydoc\n`
    );
  }

  return toMarkdown(inputPath);
}

async function convert({ input, format, outDir, force }) {
  if (!fs.existsSync(input)) throw new Error(`No such file: ${input}`);

  const title = path.basename(input, path.extname(input));
  const dir = outDir || path.dirname(input);
  fs.mkdirSync(dir, { recursive: true });

  const raw = await toMarkdown(input);

  const order = detectVisualOrder(raw);
  if (order.reversed && !force) {
    throw new Error(
      `Extracted Hebrew is in visual order — every word is character-reversed.\n` +
      `(${order.leading} words start with a final-form letter, ${order.trailing} end with one.)\n\n` +
      `The extractor returned visual rather than logical order, so the text was\n` +
      `scrambled before any RTL handling ran. Nothing downstream can repair it, and\n` +
      `the output would be unreadable and unsearchable.\n\n` +
      `Options:\n` +
      `  - Convert from an original .docx or .pptx instead, which extract correctly\n` +
      `  - Re-run with --force to write the output anyway\n`
    );
  }

  const markdown = addRtlSupport(raw, title, path.basename(input));
  const written = [];

  // report.docx and report.pdf both target report.md, so a second conversion would
  // quietly replace the first. Overwriting a re-run of the same source is expected.
  const warnIfForeign = outPath => {
    if (!fs.existsSync(outPath)) return;
    const existing = fs.readFileSync(outPath, 'utf8');
    const source = (existing.match(/^source:\s*(.+)$/m) || [])[1];
    if (source && source.trim() !== path.basename(input)) {
      console.warn(`Warning: ${path.basename(outPath)} was converted from ${source.trim()} — overwriting.`);
    }
  };

  if (format === 'md' || format === 'both') {
    const mdPath = path.join(dir, `${title}.md`);
    warnIfForeign(mdPath);
    fs.writeFileSync(mdPath, markdown, 'utf8');
    written.push(mdPath);
  }

  if (format === 'html' || format === 'both') {
    const htmlPath = path.join(dir, `${title}.html`);
    fs.writeFileSync(htmlPath, renderHtml(markdown), 'utf8');
    written.push(htmlPath);
  }

  if (written.length === 0) {
    throw new Error(`Unknown --format "${format}". Use md, html, or both.`);
  }
  written.forEach(p => console.log(`Written: ${p}`));
}

const args = parseArgs(process.argv.slice(2));
if (!args.input) {
  console.error('Usage: node convert.js <input-file> [--format md|html|both] [--out-dir <dir>]');
  process.exit(1);
}
convert(args).catch(err => { console.error(err.message); process.exit(1); });
