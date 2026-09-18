#!/usr/bin/env node
/**
 * OCR the pages anydoc could not read, then hand the result back through anydoc so the
 * same checks apply to the text OCR produced.
 *
 * This is not part of anydoc, and deliberately so. anydoc's whole guarantee rests on
 * `--verify` comparing output against a page's own text layer; the moment that layer is
 * a guess instead of what the document's author wrote, the comparison is against a guess
 * and nothing says so on its own. Keeping this separate keeps that guarantee legible:
 * anydoc still means exactly what it always meant on every page it reads itself, and a
 * page that went through this tool instead is named as having gone through it, in both
 * the prose and the JSON this writes alongside anydoc's own output.
 *
 * What this refuses to do is the more important half. OCR only ever runs on the pages
 * anydoc's own --report already named PICTURE ONLY, restricted there by ocrmypdf's own
 * --pages and --skip-text (see src/ocr-args.js), and the result is checked again
 * afterwards — see src/reconcile.js — before anything is written to the real output
 * directory. A page that already had a text layer must come back with the exact same
 * one, or nothing here is written at all. Re-guessing a page that was already read
 * correctly is the failure this whole project exists to catch, and this tool is not
 * exempt from that just because it is the one calling OCR.
 *
 * Usage:
 *   node src/ocr.js <input.pdf> [--out-dir <dir>] [--lang heb+eng] [--format md|html|both]
 *
 * Exit codes:
 *   0  done — OCR ran and reconciled cleanly, or there was nothing here for it to do
 *   1  ordinary failure (bad arguments, missing file, not a PDF, ocrmypdf itself errored)
 *   5  ocrmypdf or a needed tesseract language is not installed
 *   6  OCR changed a page it was not asked to touch — refused to use the result
 */

const EXIT_FAILURE = 1;
const EXIT_MISSING_TOOL = 5;
const EXIT_REFUSED = 6;

const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync, spawnSync } = require('child_process');
const { parseArgs, buildOcrArgs } = require('./ocr-args');

const CONVERT = path.join(__dirname, 'convert.js');

/**
 * Fail before touching anything if the tools this depends on are not there, rather than
 * partway through with a half-written scratch directory to explain.
 *
 * The language check matters as much as the binary check. OCR without heb.traineddata
 * does not fail loudly — it either falls back to a language that gets Hebrew wrong in a
 * way nothing downstream would catch, or it errors in a way this cannot tell apart from
 * any other tesseract failure. Checked explicitly so the message names the actual gap.
 */
function requireTools(lang) {
  try {
    execFileSync('ocrmypdf', ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch {
    throw Object.assign(new Error(
      `ocrmypdf is not installed, or not on PATH.\n\n` +
      `  Debian/Ubuntu:  sudo apt-get install ocrmypdf tesseract-ocr-heb\n` +
      `  macOS:          brew install ocrmypdf tesseract-lang\n` +
      `  pip (any OS):   pip install ocrmypdf   (tesseract and its language data still\n` +
      `                  come from your OS package manager, not from pip)\n\n` +
      `This is only needed for pages anydoc itself reports as PICTURE ONLY — nothing\n` +
      `anydoc converts on its own depends on it.`
    ), { exitCode: EXIT_MISSING_TOOL });
  }

  const codes = lang.split('+').filter(Boolean);
  const probe = spawnSync('tesseract', ['--list-langs'], { encoding: 'utf8' });
  // Tesseract has written this list to stdout and to stderr across different versions,
  // so both are read rather than guessing which this one uses.
  const listing = `${probe.stdout || ''}\n${probe.stderr || ''}`;

  const missing = codes.filter(code => !new RegExp(`(^|[^a-z])${code}([^a-z]|$)`, 'i').test(listing));
  if (missing.length) {
    throw Object.assign(new Error(
      `tesseract has no language data for: ${missing.join(', ')}.\n\n` +
      `  Debian/Ubuntu:  sudo apt-get install ${missing.map(l => `tesseract-ocr-${l}`).join(' ')}\n` +
      `  macOS:          brew install tesseract-lang\n\n` +
      `Without it this would either fail outright or silently OCR in the wrong script,\n` +
      `and nothing downstream would be able to tell the difference.`
    ), { exitCode: EXIT_MISSING_TOOL });
  }
}

/**
 * Run anydoc's own convert.js and read back the JSON --report it writes, treating exit
 * 3 (findings, but the files were written) as success and anything else as a real
 * failure this cannot route around.
 */
function convert(args, reportPath) {
  const result = spawnSync(process.execPath, [CONVERT, ...args, '--report', reportPath],
    { encoding: 'utf8' });
  if (result.status !== 0 && result.status !== 3) {
    throw Object.assign(new Error((result.stderr || result.stdout || '').trim()
      || `anydoc exited ${result.status}`), { exitCode: result.status });
  }
  return {
    stdout: result.stdout,
    report: JSON.parse(fs.readFileSync(reportPath, 'utf8')),
  };
}

function scratchDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'anydoc-ocr-'));
}

async function run({ input, outDir, lang, format }) {
  if (!fs.existsSync(input)) throw new Error(`No such file: ${input}`);
  if (path.extname(input).toLowerCase() !== '.pdf') {
    throw new Error(
      `${path.basename(input)} is not a PDF. OCR only applies to the pages of a PDF ` +
      `anydoc reports as PICTURE ONLY — every other format either has no such concept ` +
      `or is better converted from its own source than from a scan of it.`
    );
  }

  const title = path.basename(input, path.extname(input));
  const work = scratchDir();

  // A first pass purely to see what anydoc makes of the document as it is. --force is
  // needed here specifically: a fully-scanned PDF has no text at all, and convert.js
  // refuses that outright rather than writing an empty file — which is exactly the
  // refusal this tool exists to work around, so it has to see past it to read the report.
  const before = convert(
    [input, '--format', 'md', '--out-dir', work, '--force', '--verify'],
    path.join(work, 'before.json'));

  const pictureOnly = before.report.pictureOnly;
  const illustrated = [...new Set((before.report.illustrations || []).map(i => i.page))];

  if (!pictureOnly.length) {
    if (illustrated.length) {
      console.log(
        `Nothing here for OCR to safely do. Page(s) ${illustrated.join(', ')} carry a ` +
        `large image, but they already have a text layer — OCR-ing them would mean ` +
        `redoing the whole page and risking the text that already reads correctly, ` +
        `which this refuses to do. Read those pages directly if they matter.\n\n` +
        `Run anydoc on ${path.basename(input)} directly; it already reads everything ` +
        `this tool would otherwise add.`
      );
    } else {
      console.log(
        `Nothing here for OCR to do — anydoc already read every page of ` +
        `${path.basename(input)}. Run it directly; there is nothing this adds.`
      );
    }
    return;
  }

  // Only checked now: nothing above needed ocrmypdf, and a document with nothing to
  // OCR should never fail here for a tool it was never going to call.
  requireTools(lang);

  console.log(
    `Page(s) ${pictureOnly.join(', ')} have no text layer. Running OCR on ` +
    `${pictureOnly.length === 1 ? 'that page' : 'those pages'} only (${lang}) — every ` +
    `other page is left exactly as anydoc already read it.`
  );

  const ocrPdf = path.join(work, `${title}.pdf`);
  const ocrRun = spawnSync('ocrmypdf', buildOcrArgs(input, ocrPdf, pictureOnly, lang),
    { encoding: 'utf8' });
  if (ocrRun.status !== 0) {
    throw new Error(
      `ocrmypdf failed (exit ${ocrRun.status}):\n\n${(ocrRun.stderr || ocrRun.stdout || '').trim()}`
    );
  }

  // The second read, over exactly the same page set, through exactly the same checks.
  const afterDir = path.join(work, 'after');
  const after = convert(
    [ocrPdf, '--format', format, '--out-dir', afterDir, '--verify'],
    path.join(work, 'after.json'));

  const { reconcile, reconcileReport } = require('./reconcile');
  const result = reconcile(before.report, after.report);

  if (!result.ok) {
    console.error(reconcileReport(result));
    throw Object.assign(new Error(
      `Refusing to write output — OCR changed something it should not have. ` +
      `${path.basename(input)} was not touched; run anydoc on it directly if you want ` +
      `the unenriched conversion.`
    ), { exitCode: EXIT_REFUSED });
  }

  // Only now, with the result checked, does anything land in the caller's own
  // directory — a failed reconciliation above must leave it exactly as it was.
  const dest = outDir || path.dirname(input);
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(afterDir)) {
    fs.copyFileSync(path.join(afterDir, name), path.join(dest, name));
    console.log(`Written: ${path.join(dest, name)}`);
  }

  // anydoc's own report and rendered output say nothing about where any given page's
  // text came from — that question does not exist for anything anydoc reads itself, and
  // teaching its schema to answer it would be scope this tool has no business adding.
  // This is that answer, kept in this tool's own report, next to anydoc's.
  const ocrReport = {
    schema: 1,
    tool: 'anydoc-ocr',
    version: require('../package.json').version,
    source: path.basename(input),
    lang,
    ocrPassed: pictureOnly,
    recovered: result.recovered,
    stillUnreadable: result.stillUnreadable,
    provenance: result.provenance,
  };
  const jsonPath = path.join(dest, `${title}.ocr-report.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(ocrReport, null, 2), 'utf8');
  console.log(`Written: ${jsonPath}`);

  console.log('\n' + reconcileReport(result));
}

if (require.main === module) {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    process.exit(EXIT_FAILURE);
  }
  if (!args.input) {
    console.error('Usage: node src/ocr.js <input.pdf> [--out-dir <dir>] ' +
                  '[--lang heb+eng] [--format md|html|both]');
    process.exit(EXIT_FAILURE);
  }
  run(args).catch(err => {
    console.error(err.message);
    process.exit(err.exitCode || EXIT_FAILURE);
  });
}

module.exports = { run, requireTools };
