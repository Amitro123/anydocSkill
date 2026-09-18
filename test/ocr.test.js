/**
 * src/ocr.js end to end.
 *
 * Real OCR is not available here or in CI — nothing installs ocrmypdf for this
 * repository, on purpose, since the whole point of keeping it a separate tool is that
 * anydoc itself never needs it. Two things follow from that, and both are tested:
 *
 * The "tool is missing" path is real, not simulated: that one case runs with PATH
 * emptied out, rather than relying on ocrmypdf being absent from this machine — which,
 * unlike a fresh CI runner, it may not be (this suite was written on one where it was
 * installed for a separate investigation). Emptying PATH reproduces the same failure a
 * person hitting this for the first time will actually see, on any machine.
 *
 * Everything past that point — argument handling, one ocrmypdf invocation per picture
 * page, the corrected pages that come from their transcripts, reconciliation — is real
 * src/ocr.js and src/ocr-pdf.js code running against a stub in test/fake-bin standing
 * in for ocrmypdf and tesseract. The stub's transcripts are fully determined by
 * FAKE_OCR_SIDECAR, an env var each case sets, so what is under test is never the stub
 * — it is what src/ocr.js does with what OCR handed back.
 *
 * What this suite does *not* attempt: making the stub corrupt a page it was not asked
 * to touch, the way an earlier version of this file did to exercise reconcile.js's
 * refusal path. That is no longer something the ocrmypdf-facing surface can cause —
 * src/ocr-pdf.js's assembleFinalPdf() copies every other page's own PDF objects
 * directly from the original file, never re-extracting or re-rendering them, so there
 * is nothing on that path left for a misbehaving OCR run to corrupt. That guarantee is
 * what test/ocr-pdf.test.js proves (a copied page verifies to the same digest as
 * reading the original alone), and reconcile.js's *decision* to refuse on a mismatch —
 * the part that would still matter if that guarantee were ever weakened — is unit
 * tested directly in src/rtl.test.js.
 */

const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const fx = require('./fixtures');

const CLI = path.join(__dirname, '..', 'src', 'ocr.js');
const FAKE_BIN = path.join(__dirname, 'fake-bin');
const dir = fx.tempDir();
process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));

// Keyed by page number as a string, matching how JSON.stringify renders a plain object
// with numeric keys — and how the stub reads --pages N back out of argv.
const withFakeTools = sidecar => ({
  ...process.env,
  PATH: `${FAKE_BIN}:${process.env.PATH}`,
  FAKE_OCR_SIDECAR: JSON.stringify(sidecar),
});

function run(args, env = process.env) {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] });
    return { status: 0, stdout, stderr: '' };
  } catch (err) {
    return { status: err.status, stdout: err.stdout || '', stderr: err.stderr || '' };
  }
}

const PAGE1 = 'The parties agree to cooperate in good faith.';
const mixed = () => fx.writeMixedPdf(dir, [PAGE1, null], `mixed-${Date.now()}-${Math.random()}.pdf`);

// --- Nothing to do, with no tools required at all ---
{
  const all = fx.writeMultiPagePdf(dir, 2);
  const out = path.join(dir, 'nothing-out');
  const result = run([all, '--out-dir', out]);
  assert.strictEqual(result.status, 0, `an all-text document needs no tools: ${result.stderr}`);
  assert(/Nothing here for OCR to do/.test(result.stdout));
  assert(!fs.existsSync(out), 'and writes nothing, since there is nothing to add');
}

// --- An image among text: not OCR's to fix, and no tools required either ---
{
  const illustrated = fx.writeIllustratedPdf(dir);
  const out = path.join(dir, 'illustrated-out');
  const result = run([illustrated, '--out-dir', out]);
  assert.strictEqual(result.status, 0);
  assert(/Nothing here for OCR to safely do/.test(result.stdout));
  assert(/Page\(s\) 2/.test(result.stdout), 'the page carrying the chart is named');
  assert(!fs.existsSync(out));
}

// --- The tool really is missing — PATH emptied out, not relying on ambient absence ---
{
  const doc = mixed();
  const out = path.join(dir, 'missing-tool-out');
  const result = run([doc, '--out-dir', out], { ...process.env, PATH: '' });
  assert.strictEqual(result.status, 5, `expected exit 5, got ${result.status}: ${result.stderr}`);
  assert(/ocrmypdf is not installed/.test(result.stderr));
  assert(/apt-get install ocrmypdf/.test(result.stderr), 'and says how to fix it');
  assert(!fs.existsSync(out));
}

// --- A clean OCR pass: the untouched page reads exactly as it always did, the
// recovered page holds its own transcript, nothing else changes. ---
{
  const doc = mixed();
  const out = path.join(dir, 'clean-out');
  const result = run([doc, '--out-dir', out, '--format', 'md'],
    withFakeTools({ 2: 'OCR RECOVERED TEXT' }));

  assert.strictEqual(result.status, 0, `expected success: ${result.stderr}`);
  assert(/OCR added a text layer to 1 page\(s\): 2/.test(result.stdout));
  assert(/guess, not a reading/.test(result.stdout), 'the OCR text is flagged as less certain');

  const md = fs.readFileSync(path.join(out, path.basename(doc, '.pdf') + '.md'), 'utf8');
  assert(md.includes(PAGE1), 'the original page reaches the output unchanged');
  assert(md.includes('OCR RECOVERED TEXT'), 'and the OCR text is in it too');

  const report = JSON.parse(
    fs.readFileSync(path.join(out, path.basename(doc, '.pdf') + '.ocr-report.json'), 'utf8'));
  assert.strictEqual(report.schema, 1);
  assert.deepStrictEqual(report.recovered, [2]);
  assert.deepStrictEqual(report.provenance, { 1: 'original', 2: 'ocr' },
    'each page is attributed to where its text came from');
}

// --- A multi-line transcript survives as more than one run-on sentence. ---
{
  const doc = mixed();
  const out = path.join(dir, 'multiline-out');
  const result = run([doc, '--out-dir', out, '--format', 'md'],
    withFakeTools({ 2: 'שורה ראשונה\nשורה שנייה' }));

  assert.strictEqual(result.status, 0, `expected success: ${result.stderr}`);
  const md = fs.readFileSync(path.join(out, path.basename(doc, '.pdf') + '.md'), 'utf8');
  assert(md.includes('שורה ראשונה'), `first line missing from:\n${md}`);
  assert(md.includes('שורה שנייה'), `second line missing from:\n${md}`);
}

// --- OCR itself failing (a corrupt input, no permission, tesseract crashing) is an
// ordinary failure, not a silent no-op. ---
{
  const doc = mixed();
  const out = path.join(dir, 'ocr-fail-out');
  const env = withFakeTools({ 2: 'irrelevant' });
  env.FAKE_OCR_FAIL = 'tesseract crashed';
  const result = run([doc, '--out-dir', out, '--format', 'md'], env);

  assert.strictEqual(result.status, 1);
  assert(/ocrmypdf failed/.test(result.stderr));
  assert(!fs.existsSync(out));
}

// --- Still unreadable: OCR ran and found nothing, which is a fact worth keeping, not
// a failure of this tool. ---
{
  const doc = mixed();
  const out = path.join(dir, 'still-out');
  const result = run([doc, '--out-dir', out, '--format', 'md'], withFakeTools({}));

  assert.strictEqual(result.status, 0, `expected success: ${result.stderr}`);
  assert(/STILL UNREADABLE/.test(result.stdout));
  assert(fs.existsSync(path.join(out, path.basename(doc, '.pdf') + '.md')),
    'output is still written — the rest of the document is fine');
}

console.log('All OCR pipeline tests passed.');
