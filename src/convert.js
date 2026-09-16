#!/usr/bin/env node
/**
 * Convert a document to RTL-aware Markdown and/or a standalone HTML document.
 *
 * Usage:
 *   node convert.js <input-file> [--format md|html|both] [--out-dir <dir>]
 *                                [--pages <spec>] [--ingest] [--force]
 *
 * Exit codes are part of the interface, so callers in any language can tell a
 * scrambled-text rejection from an ordinary failure without parsing stderr:
 *   0  success
 *   1  failure (missing file, unsupported format, bad arguments)
 *   2  extraction returned text in visual order and was refused
 */

const EXIT_FAILURE = 1;
const EXIT_VISUAL_ORDER = 2;

const path = require('path');
const fs = require('fs');
const { addRtlSupport, detectVisualOrder } = require('./rtl');
const { promoteHeadings } = require('./headings');
const { preserveNumbering } = require('./numbering');
const { renderHtml } = require('./render-html');
const { parsePageSpec } = require('./convert-args');

function parseArgs(argv) {
  const args = { format: 'both', outDir: null, input: null, force: false, ingest: false, pages: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--format') args.format = argv[++i];
    else if (argv[i] === '--out-dir') args.outDir = argv[++i];
    else if (argv[i] === '--pages') args.pages = parsePageSpec(argv[++i]);
    else if (argv[i] === '--force') args.force = true;
    else if (argv[i] === '--ingest') args.ingest = true;
    else if (!args.input) args.input = argv[i];
  }
  return args;
}

async function toMarkdown(inputPath, pages = null) {
  const ext = path.extname(inputPath).toLowerCase();

  // Only PDFs are paginated here. Silently ignoring the flag on anything else
  // would hand back the whole document as though the selection had applied.
  if (pages && ext !== '.pdf') {
    throw new Error(`--pages only applies to PDFs; ${ext || 'this input'} has no page numbers.`);
  }

  // Text input needs no conversion — go straight to RTL post-processing. anydoc
  // rejects .txt outright, and plain text is the one thing it never needs to parse.
  if (['.md', '.markdown', '.txt'].includes(ext)) {
    return fs.readFileSync(inputPath, 'utf8');
  }

  // anydoc extracts PDF text in visual order, which scrambles Hebrew and Arabic
  // beyond repair. pdf.js returns logical order, so PDFs go through it instead.
  if (ext === '.pdf') {
    const { pdfToMarkdown } = require('./pdf-extract');
    return pdfToMarkdown(inputPath, { pages });
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

async function convert({ input, format, outDir, force, ingest, pages }) {
  if (!fs.existsSync(input)) throw new Error(`No such file: ${input}`);

  const title = path.basename(input, path.extname(input));
  const dir = outDir || path.dirname(input);
  fs.mkdirSync(dir, { recursive: true });

  const raw = await toMarkdown(input, pages);

  // A PDF that was scanned but never OCR'd has no text layer, so extraction
  // succeeds and returns nothing. Writing an empty document without a word about
  // why leaves the user with no way to tell that from a broken converter.
  if (!raw.replace(/\s/g, '')) {
    console.warn(
      `Warning: no text found in ${path.basename(input)} — the output will be empty.\n` +
      `If this is a scan, it has no text layer yet; add one first (for example with ` +
      `ocrmypdf) and convert the result.`
    );
  }

  const order = detectVisualOrder(raw);
  if (order.reversed && !force) {
    throw Object.assign(new Error(
      `Extracted Hebrew is in visual order — every word is character-reversed.\n` +
      `(${order.leading} words start with a final-form letter, ${order.trailing} end with one.)\n\n` +
      `The extractor returned visual rather than logical order, so the text was\n` +
      `scrambled before any RTL handling ran. Nothing downstream can repair it, and\n` +
      `the output would be unreadable and unsearchable.\n\n` +
      `Options:\n` +
      `  - Convert from an original .docx or .pptx instead, which extract correctly\n` +
      `  - Re-run with --force to write the output anyway\n`
    ), { exitCode: EXIT_VISUAL_ORDER });
  }

  const markdown = addRtlSupport(preserveNumbering(promoteHeadings(raw)), {
    title,
    source: path.basename(input),
    ingest: ingest ? {
      type: path.extname(input).slice(1).toLowerCase(),
      location: input,
      extractedAt: new Date().toISOString().slice(0, 10),
    } : null,
  });
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

let args;
try {
  args = parseArgs(process.argv.slice(2));
} catch (err) {
  console.error(err.message);
  process.exit(EXIT_FAILURE);
}
if (!args.input) {
  console.error('Usage: node convert.js <input-file> [--format md|html|both] ' +
                '[--out-dir <dir>] [--pages <spec>] [--ingest] [--force]');
  process.exit(EXIT_FAILURE);
}
convert(args).catch(err => {
  console.error(err.message);
  process.exit(err.exitCode || EXIT_FAILURE);
});
