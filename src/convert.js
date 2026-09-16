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

  // Markdown input needs no conversion — go straight to RTL post-processing.
  if (ext === '.md' || ext === '.markdown') {
    return fs.readFileSync(inputPath, 'utf8');
  }

  // anydoc extracts PDF text in visual order, which scrambles Hebrew and Arabic
  // beyond repair. pdf.js returns logical order, so PDFs go through it instead.
  if (ext === '.pdf') {
    const { pdfToMarkdown } = require('./pdf-extract');
    return pdfToMarkdown(inputPath);
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
  const title = path.basename(input, path.extname(input));
  const dir = outDir || path.dirname(input);
  fs.mkdirSync(dir, { recursive: true });

  const raw = await toMarkdown(input);

  const order = detectVisualOrder(raw);
  if (order.reversed && !force) {
    throw new Error(
      `Extracted Hebrew is in visual order — every word is character-reversed.\n` +
      `(${order.leading} words start with a final-form letter, ${order.trailing} end with one.)\n\n` +
      `This is an anydoc PDF extraction bug for RTL scripts, not a rendering problem:\n` +
      `the text is already scrambled before any RTL handling runs, so the output would\n` +
      `be unreadable and unsearchable.\n\n` +
      `Options:\n` +
      `  - Convert from the original .docx instead, which extracts correctly\n` +
      `  - Re-run with --force to write the output anyway\n`
    );
  }

  const markdown = addRtlSupport(raw, title);
  const written = [];

  if (format === 'md' || format === 'both') {
    const mdPath = path.join(dir, `${title}.md`);
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
