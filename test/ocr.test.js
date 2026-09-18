/**
 * src/ocr.js end to end.
 *
 * Real OCR is not available here or in CI — nothing installs ocrmypdf for this
 * repository, on purpose, since the whole point of keeping it a separate tool is that
 * anydoc itself never needs it. Two things follow from that, and both are tested:
 *
 * The "tool is missing" path is not a simulation. ocrmypdf genuinely is not on PATH in
 * this environment, the same as it will not be on a fresh CI runner, so that assertion
 * exercises the real failure a person hitting this for the first time will actually see.
 *
 * Everything past that point — argument handling, the second read through anydoc,
 * reconciliation, what gets written and what does not — is real src/ocr.js code running
 * against a stub in test/fake-bin standing in for ocrmypdf and tesseract. The stub's
 * output is fully determined by FAKE_OCR_PAGE_TEXTS, an env var each case sets, so what
 * is under test is never the stub — it is what src/ocr.js does with what OCR handed back.
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

const withFakeTools = pageTexts => ({
  ...process.env,
  PATH: `${FAKE_BIN}:${process.env.PATH}`,
  FAKE_OCR_PAGE_TEXTS: JSON.stringify(pageTexts),
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

// --- The tool really is missing here, same as on a fresh machine ---
{
  const doc = mixed();
  const out = path.join(dir, 'missing-tool-out');
  const result = run([doc, '--out-dir', out]);
  assert.strictEqual(result.status, 5, `expected exit 5, got ${result.status}: ${result.stderr}`);
  assert(/ocrmypdf is not installed/.test(result.stderr));
  assert(/apt-get install ocrmypdf/.test(result.stderr), 'and says how to fix it');
  assert(!fs.existsSync(out));
}

// --- A clean OCR pass: the untouched page reproduces its own text exactly ---
{
  const doc = mixed();
  const out = path.join(dir, 'clean-out');
  const result = run([doc, '--out-dir', out, '--format', 'md'],
    withFakeTools([PAGE1, 'OCR RECOVERED TEXT']));

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

// --- The refusal path: OCR (or recompression, or anything else) altered a page it
// should not have. This is the one case that must never write anything. ---
{
  const doc = mixed();
  const out = path.join(dir, 'refused-out');
  const result = run([doc, '--out-dir', out, '--format', 'md'],
    withFakeTools(['SOMETHING ELSE ENTIRELY', 'OCR RECOVERED TEXT']));

  assert.strictEqual(result.status, 6, `expected exit 6, got ${result.status}`);
  assert(/REFUSED/.test(result.stderr));
  assert(/not being used/.test(result.stderr));
  assert(!fs.existsSync(out), 'nothing is written when reconciliation fails');
}

// --- OCR itself failing (a corrupt input, no permission, tesseract crashing) is an
// ordinary failure, not a silent no-op. ---
{
  const doc = mixed();
  const out = path.join(dir, 'ocr-fail-out');
  const env = withFakeTools([PAGE1, 'irrelevant']);
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
  const result = run([doc, '--out-dir', out, '--format', 'md'],
    withFakeTools([PAGE1, null]));

  assert.strictEqual(result.status, 0);
  assert(/STILL UNREADABLE/.test(result.stdout));
  assert(fs.existsSync(path.join(out, path.basename(doc, '.pdf') + '.md')),
    'output is still written — the rest of the document is fine');
}

console.log('All OCR pipeline tests passed.');
