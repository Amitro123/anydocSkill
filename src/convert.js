#!/usr/bin/env node
/**
 * Convert a document to RTL-aware Markdown and/or a standalone HTML document.
 *
 * Usage:
 *   node convert.js <input-file> [--format md|html|both] [--out-dir <dir>]
 *                                [--pages <spec>] [--ingest] [--force]
 *                                [--verify] [--report <path>|-]
 *
 * Exit codes are part of the interface, so callers in any language can tell a
 * scrambled-text rejection from an ordinary failure without parsing stderr:
 *   0  success
 *   1  failure (missing file, unsupported format, bad arguments)
 *   2  extraction returned text in visual order and was refused
 *   3  --verify found text missing from the output, or a number changed
 *   4  the document holds no text to convert (an un-OCR'd scan)
 */

const EXIT_FAILURE = 1;
const EXIT_VISUAL_ORDER = 2;
const EXIT_UNVERIFIED = 3;
const EXIT_NO_TEXT = 4;

const path = require('path');
const fs = require('fs');
const { addRtlSupport, detectVisualOrder, detectDocumentLanguage } = require('./rtl');
const { promoteHeadings } = require('./headings');
const { preserveNumbering } = require('./numbering');
const { renderHtml } = require('./render-html');
const { parsePageSpec } = require('./convert-args');

const FLAGS = ['--format', '--out-dir', '--pages', '--force', '--ingest', '--verify', '--report'];
const VALUED = new Set(['--format', '--out-dir', '--pages', '--report']);

/**
 * Parse the command line, refusing anything it does not recognise.
 *
 * Ignoring an unknown flag is how a mistyped `--verify` produces a conversion that
 * looks checked and is not, and the skill's own instructions are to pass it on every
 * PDF. A typo has to fail rather than quietly downgrade what the run does.
 */
function parseArgs(argv) {
  const args = {
    format: 'both', outDir: null, input: null,
    force: false, ingest: false, pages: null, verify: false, report: null,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg.startsWith('-')) {
      if (!FLAGS.includes(arg)) {
        throw new Error(`Unknown option "${arg}". Options are: ${FLAGS.join(', ')}.`);
      }
      // A lone "-" is the conventional name for the standard stream, and only --report
      // has one to write to — accepting it for --out-dir or --pages would silently
      // create a literal "./-" directory or hand "-" to the page-spec parser instead of
      // refusing outright.
      const next = argv[i + 1];
      const bareDash = next === '-' && arg === '--report';
      if (VALUED.has(arg) && (next === undefined || (next.startsWith('-') && !bareDash))) {
        throw new Error(`${arg} needs a value.`);
      }

      if (arg === '--format') args.format = argv[++i];
      else if (arg === '--out-dir') args.outDir = argv[++i];
      else if (arg === '--pages') args.pages = parsePageSpec(argv[++i]);
      else if (arg === '--report') args.report = argv[++i];
      else args[arg.slice(2)] = true;
      continue;
    }

    if (args.input) throw new Error(`Only one input file at a time; got "${args.input}" and "${arg}".`);
    args.input = arg;
  }

  if (!['md', 'html', 'both'].includes(args.format)) {
    throw new Error(`Unknown --format "${args.format}". Use md, html, or both.`);
  }
  return args;
}

/**
 * Write, then rename into place.
 *
 * A crash or a full disk mid-write leaves a truncated file sitting at the destination
 * — and the next run's own overwrite guard (see warnIfForeign below) reads a half
 * written file back as if it were a real, if odd, prior conversion. A rename within the
 * same directory is a single filesystem operation: the destination is either the old
 * content or the complete new content, never a partial write of either.
 */
function writeFileAtomic(destPath, content) {
  const tmpPath = `${destPath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, content, 'utf8');
  fs.renameSync(tmpPath, destPath);
}

async function toMarkdown(inputPath, pages = null) {
  const ext = path.extname(inputPath).toLowerCase();

  // Only PDFs are paginated here. Silently ignoring the flag on anything else
  // would hand back the whole document as though the selection had applied.
  if (pages && ext !== '.pdf') {
    throw new Error(`--pages only applies to PDFs; ${ext || 'this input'} has no page numbers.`);
  }

  // Text input needs no conversion — go straight to RTL post-processing. The
  // firecrawl/anydoc extractor rejects .txt outright, and plain text is the one thing
  // that never needs parsing anyway.
  if (['.md', '.markdown', '.txt'].includes(ext)) {
    return fs.readFileSync(inputPath, 'utf8');
  }

  // The firecrawl/anydoc extractor returns PDF text in visual order, which scrambles
  // Hebrew and Arabic beyond repair. pdf.js returns logical order, so PDFs are read
  // here instead — the headline reason this tool exists rather than wrapping that one.
  if (ext === '.pdf') {
    const { pdfToMarkdown } = require('./pdf-extract');
    return pdfToMarkdown(inputPath, { pages });
  }

  // The firecrawl/anydoc extractor flattens a deck into one continuous run, losing
  // slide boundaries.
  if (ext === '.pptx') {
    const { pptxToMarkdown } = require('./pptx-extract');
    return pptxToMarkdown(inputPath);
  }

  let toMarkdown;
  try {
    ({ toMarkdown } = require('@firecrawl/anydoc'));
  } catch {
    throw new Error(
      `Converting ${ext} needs the firecrawl/anydoc extractor. Install it with:\n\n` +
      `  npm install @firecrawl/anydoc\n`
    );
  }

  return toMarkdown(inputPath);
}

async function convert({
  input, format, outDir, force, ingest, pages, verify: shouldVerify, report: reportPath,
}) {
  if (!fs.existsSync(input)) throw new Error(`No such file: ${input}`);

  const title = path.basename(input, path.extname(input));
  const dir = outDir || path.dirname(input);
  fs.mkdirSync(dir, { recursive: true });

  // With the report itself on stdout, stdout carries JSON and nothing else: a caller
  // parsing it cannot also be asked to step over "Written:" lines to find the start.
  // Everything addressed to a person moves to stderr, which is where narration belongs.
  const toStdout = reportPath === '-';
  const say = toStdout ? console.error : console.log;

  const raw = await toMarkdown(input, pages);

  // A PDF that was scanned but never OCR'd has no text layer, so extraction succeeds
  // and returns nothing. Writing the empty document and reporting success is the
  // silent loss this tool refuses everywhere else: a batch caller scripted against the
  // exit codes would file a 200-page scan as converted.
  if (!raw.replace(/\s/g, '') && !force) {
    throw Object.assign(new Error(
      `No text found in ${path.basename(input)} — nothing was written.\n\n` +
      `If this is a scan, it has no text layer yet. Add one first (ocrmypdf is the\n` +
      `usual tool) and convert the result.\n\n` +
      `Re-run with --force to write the empty document anyway.\n`
    ), { exitCode: EXIT_NO_TEXT });
  }

  // The scrambled-text check reads Hebrew final forms, so it has nothing to go on for
  // another RTL script or for a document with barely any Hebrew in it. Saying so is the
  // point: silence here reads as "checked and clean", which is the one thing it is not.
  const { dir: documentDir, lang: documentLang } = detectDocumentLanguage(raw);
  const order = detectVisualOrder(raw);
  if (documentDir === 'rtl' && !order.judged && !order.reversed) {
    console.warn(
      `Warning: this document is right-to-left, but the scrambled-text check could not ` +
      `judge it${documentLang && documentLang !== 'he' ? ` — it reads Hebrew final forms, and this is not Hebrew` : ` — only ${order.words} Hebrew word(s) to go on`}.\n` +
      `Scrambled text would not have been caught. Read the output before relying on it.`
    );
  }
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
  // Both outputs record where they came from — the Markdown in its front-matter, the
  // HTML in a meta tag — so neither can be clobbered without a word.
  const warnIfForeign = outPath => {
    if (!fs.existsSync(outPath)) return;
    const existing = fs.readFileSync(outPath, 'utf8');
    const { parseFrontMatter } = require('./render-html');
    const source = parseFrontMatter(existing).meta.source
      || (existing.match(/<meta name="source" content="([^"]*)">/) || [])[1];
    if (source && source !== path.basename(input)) {
      console.warn(`Warning: ${path.basename(outPath)} was converted from ${source} — overwriting.`);
    }
  };

  if (format === 'md' || format === 'both') {
    const mdPath = path.join(dir, `${title}.md`);
    warnIfForeign(mdPath);
    writeFileAtomic(mdPath, markdown);
    written.push(mdPath);
  }

  const html = renderHtml(markdown);

  if (format === 'html' || format === 'both') {
    const htmlPath = path.join(dir, `${title}.html`);
    warnIfForeign(htmlPath);
    writeFileAtomic(htmlPath, html);
    written.push(htmlPath);
  }

  written.forEach(p => say(`Written: ${p}`));

  // --report is the same check asked for in a different format, so it runs the
  // verification whether or not --verify was also passed. A report written from a run
  // that never verified would state a `passed` it had not established.
  if (!shouldVerify && !reportPath) return;

  const { verify, report, reportJson, passed } = require('./verify');
  const result = await verify(input, { raw, html, pages });

  if (reportPath) {
    const json = JSON.stringify(reportJson(result, { source: path.basename(input) }), null, 2);
    if (toStdout) console.log(json);
    else {
      writeFileAtomic(reportPath, json);
      say(`Report: ${reportPath}`);
    }
  }

  // The prose report is for a person. Printing it beside the JSON a caller asked for
  // would be noise in the one place that is not reading prose.
  if (shouldVerify) say(report(result, { name: path.basename(input) }));
  if (!passed(result)) process.exitCode = EXIT_UNVERIFIED;
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
                '[--out-dir <dir>] [--pages <spec>] [--ingest] [--force] [--verify] ' +
                '[--report <path>|-]');
  process.exit(EXIT_FAILURE);
}
convert(args).catch(err => {
  console.error(err.message);
  process.exit(err.exitCode || EXIT_FAILURE);
});
