/**
 * Convert a folder of real documents and compare each against a recorded snapshot.
 *
 * The generated fixtures next door pin the behaviours someone thought to write down.
 * Real documents are what actually find defects here — every one so far came from a
 * PDF nobody had tried — and fixing one silently broke another twice: a filter meant
 * for a repeated footer deleted two tickets, an escape meant for a stray "#" flattened
 * a syllabus. Neither was caught by a test. This is the suite that catches the next one.
 *
 * Real documents stay out of the repository. They are the ones people actually convert —
 * invoices, letters, court filings — and they carry names, ID numbers and medical
 * details that have no business in a public repo or in anyone's git history. Point
 * ANYDOC_CORPUS at a folder outside it, and keep the snapshots beside the documents.
 *
 * With no folder given, the same runner converts the generated corpus in fixtures.js,
 * whose snapshots are committed under test/snapshots/. That is the version CI runs.
 *
 *   npm run corpus                                        # the generated corpus
 *   ANYDOC_CORPUS=~/anydoc-corpus npm run corpus          # compare against snapshots
 *   ANYDOC_CORPUS=~/anydoc-corpus npm run corpus -- -u    # record the current output
 *
 * A snapshot is not a statement that the output is right — it is a record of what it
 * was. Read the diff when one changes: that is the review, and the point of the suite.
 */

const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const CLI = path.join(__dirname, '..', 'src', 'convert.js');
const CONVERTIBLE = /\.(pdf|docx|doc|pptx|ppt|xlsx|xls|csv|odt|rtf|epub)$/i;

const update = process.argv.includes('-u') || process.argv.includes('--update');

// On exit, so a failing document does not leave its output behind on every run.
const scratch = [];
process.on('exit', () => scratch.forEach(d => fs.rmSync(d, { recursive: true, force: true })));

// Without a folder of real documents, the same runner converts the generated corpus
// instead, whose snapshots are committed. That is what CI has to go on: a contributor
// cannot see the private corpus, and a suite nobody can run is no signal at all.
let corpus = process.env.ANYDOC_CORPUS;
let snapshots;

if (corpus) {
  if (!fs.existsSync(corpus)) {
    console.error(`ANYDOC_CORPUS is ${corpus}, which does not exist.`);
    process.exit(1);
  }
  snapshots = path.join(corpus, 'snapshots');
} else {
  corpus = require('./fixtures').tempDir();
  scratch.push(corpus);
  require('./fixtures').writeCorpus(corpus);
  snapshots = path.join(__dirname, 'snapshots');
  console.log('No ANYDOC_CORPUS set — converting the generated corpus instead.\n');
}

fs.mkdirSync(snapshots, { recursive: true });

const documents = fs.readdirSync(corpus)
  .filter(name => CONVERTIBLE.test(name))
  .sort();

if (!documents.length) {
  console.error(`No convertible documents in ${corpus}.`);
  process.exit(1);
}

// The title is the filename, so it would differ for a document renamed or re-downloaded
// and say nothing about the conversion.
const body = md => md.replace(/^title: .*$/m, 'title: -');

let recorded = 0;
let changed = 0;
const failures = [];

for (const name of documents) {
  const input = path.join(corpus, name);
  const out = fs.mkdtempSync(path.join(require('os').tmpdir(), 'anydoc-corpus-'));
  scratch.push(out);

  let verification = '';
  let refusal = '';
  try {
    verification = execFileSync(
      process.execPath, [CLI, input, '--format', 'both', '--out-dir', out, '--verify'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    );
  } catch (err) {
    // A refusal is a verdict the tool reached about the document, not a crash, and it is
    // worth pinning for exactly the documents most likely to regress quietly — an
    // un-OCR'd scan, an extraction that came back scrambled. Exit 3 is narrower still:
    // the conversion happened and the verifier has findings about it. Anything else,
    // including a stack from a page nobody could read, is a real failure.
    if (err.status === 2 || err.status === 4) refusal = (err.stderr || '').trim();
    else if (err.status === 3) verification = err.stdout || '';
    else {
      failures.push(`${name}: conversion failed — ${(err.stderr || err.message).trim()}`);
      continue;
    }
  }

  const actual = refusal
    ? `--- refused ---\n${refusal}\n`
    : `${body(fs.readFileSync(path.join(out, `${path.parse(name).name}.md`), 'utf8')).trim()}` +
      `\n\n--- verification ---\n${
        verification.split('\n').filter(l => !l.startsWith('Written:')).join('\n').trim()}\n`;

  const snapshot = path.join(snapshots, `${name}.snapshot.md`);

  if (!fs.existsSync(snapshot) || update) {
    const isNew = !fs.existsSync(snapshot);
    fs.writeFileSync(snapshot, actual, 'utf8');
    if (isNew || fs.readFileSync(snapshot, 'utf8') !== actual) recorded++;
    console.log(`${isNew ? 'recorded' : 'updated '}  ${name}`);
    continue;
  }

  const expected = fs.readFileSync(snapshot, 'utf8');
  if (expected === actual) {
    console.log(`ok        ${name}`);
    continue;
  }

  changed++;
  const was = expected.split('\n');
  const now = actual.split('\n');
  const at = was.findIndex((line, i) => line !== now[i]);
  failures.push(
    `${name}: output changed at line ${at + 1}\n` +
    `    was: ${JSON.stringify((was[at] || '').slice(0, 120))}\n` +
    `    now: ${JSON.stringify((now[at] || '').slice(0, 120))}\n` +
    `    snapshot: ${snapshot}`
  );
}

console.log(`\n${documents.length} document(s); ${recorded} recorded, ${changed} changed.`);

if (failures.length) {
  console.error(`\n${failures.join('\n\n')}\n`);
  console.error('Read each diff. If the new output is correct, re-run with -u to record it.');
  process.exit(1);
}
assert(true);
console.log('Corpus matches its snapshots.');
