/**
 * End-to-end conversions.
 *
 * The unit tests cover pure helpers only, so nothing there would fail if a converter
 * stopped working — the extraction bugs found while building this were all invisible
 * to them. These run real files through the real pipeline.
 */

const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const fx = require('./fixtures');

const CLI = path.join(__dirname, '..', 'src', 'convert.js');
const dir = fx.tempDir();

// On exit rather than at the end of the file: a failing assertion throws past the last
// statement, and a red suite used to leave a temp directory behind on every run.
process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));

function convert(input, format = 'both', extra = []) {
  const out = path.join(dir, 'out', path.basename(input).replace(/\W/g, '_') + extra.join(''));
  execFileSync(process.execPath, [CLI, input, '--format', format, '--out-dir', out, ...extra],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

  const base = path.basename(input, path.extname(input));
  const read = ext => {
    const file = path.join(out, `${base}.${ext}`);
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  };
  return { md: read('md'), html: read('html') };
}

function assertHebrewRtl(md, label) {
  assert(/^dir: rtl$/m.test(md), `${label}: front-matter should mark RTL`);
  assert(/^lang: he$/m.test(md), `${label}: front-matter should mark Hebrew`);
  assert(md.includes('<div dir="rtl"'), `${label}: body should be wrapped RTL`);
  // A word-reversed extraction would put final forms at the start of words.
  assert(!/(\s|^)[ךםןףץ]\p{L}/u.test(md), `${label}: text must not be word-reversed`);
}

// --- Formats that route through anydoc ---
for (const [name, make] of [['csv', fx.writeCsv], ['rtf', fx.writeRtf],
                            ['xlsx', fx.writeXlsx], ['odt', fx.writeOdt]]) {
  const { md, html } = convert(make(dir));
  assert(md, `${name}: markdown should be written`);
  assertHebrewRtl(md, name);
  assert(md.includes('ישראל ישראלי'), `${name}: content should survive extraction`);
  assert(html.includes('<html dir="rtl" lang="he">'), `${name}: html carries direction`);
}

// --- Tables keep their columns ---
{
  const { md } = convert(fx.writeXlsx(dir));
  assert(/\|\s*שם\s*\|/.test(md), 'xlsx: header row should render as a table');
  assert(md.includes('123456789'), 'xlsx: ID must not be mangled');
}

// --- Plain text bypasses extraction entirely ---
{
  const { md, html } = convert(fx.writeTxt(dir));
  assertHebrewRtl(md, 'txt');
  assert(md.includes(fx.HEBREW.title), 'txt: content should pass through');
  assert(html.includes('dir="rtl"'), 'txt: html carries direction');
}

// --- Slide notes carry their slide number, in both outputs (issue #4) ---
{
  const { md, html } = convert(fx.writePptx(dir));
  assert(md.includes('<!-- Slide 1 notes -->'), 'markdown notes carry a slide marker');
  assert(/<aside data-slide="1" dir="rtl">/.test(html), 'html notes become an addressable aside');
  assert(!html.includes('<!-- Slide 1 notes -->'), 'the marker is consumed in HTML');
}

// --- --ingest adds knowledge-base metadata, and only when asked (issue #1) ---
{
  const deck = fx.writePptx(dir);
  const today = new Date().toISOString().slice(0, 10);

  const plain = convert(deck).md;
  assert(!/source_type:/.test(plain), 'ingest fields must stay opt-in');

  const { md } = convert(deck, 'md', ['--ingest']);
  assert(/^source_type: pptx$/m.test(md), 'source type comes from the extension');
  assert(md.includes(`source_location: ${JSON.stringify(deck)}`), 'source location is the path as given');
  assert(md.includes(`extracted_at: ${today}`), 'extraction date is recorded');
  assert(/^content_mode: verbatim$/m.test(md), 'content mode is recorded');
  assert(md.includes('> **Source:** deck.pptx, extracted by anydocSkill on '),
    'the source notice is prepended');
}

// --- PowerPoint: slide boundaries, notes, no page furniture ---
{
  const { md } = convert(fx.writePptx(dir));
  assertHebrewRtl(md, 'pptx');
  assert((md.match(/^## /gm) || []).length === 2, 'pptx: one section per slide');
  assert(md.includes('שקופית 1'), 'pptx: Hebrew deck uses Hebrew labels');
  assert(md.includes('להזכיר את התקציב'), 'pptx: speaker notes should be included');
  assert(!md.includes('99'), 'pptx: slide-number placeholder must not leak into the body');
  assert(!/\*\*[^*]+:\*\*\s*2\s*$/m.test(md), 'pptx: notes must not be just a slide number');
}

// --- An English deck must not come back labelled in Hebrew ---
{
  const { md } = convert(fx.writePptx(dir, { hebrew: false }));
  assert(md.includes('## Slide 1'), 'pptx: English deck uses English labels');
  assert(!md.includes('שקופית'), 'pptx: English deck must have no Hebrew labels');
  assert(/^dir: ltr$/m.test(md), 'pptx: English deck is LTR');
}

// --- PDF geometry path: lines, word spacing, paragraphs ---
{
  const { md, html } = convert(fx.writePdf(dir));
  assert(md.includes('Mediation Agreement'), 'pdf: text should be extracted');
  assert(md.includes('Case number 123456-01-26'), 'pdf: a hyphenated number stays intact');
  assert(md.includes('cooperate in good faith'), 'pdf: word spacing should be recovered');
  assert(/^dir: ltr$/m.test(md), 'pdf: a Latin document is LTR');
  assert(html.includes('<html dir="ltr"'), 'pdf: html carries direction');
}

// --- Emission order must not reach the output ---
//
// Every ordering defect found so far was the same mistake in a different place:
// code treating the order a producer emitted text in as the order to read it in.
// Asserting one known-bad ordering only pins the case already fixed, so this
// requires the same page to convert identically however it was emitted — which
// also covers the orderings no one has run into yet.
{
  const orders = Object.keys(fx.EMISSION_ORDERS);
  const body = md => md.slice(md.indexOf('---', 3));   // drop the per-file title
  const outputs = orders.map(order => ({
    order,
    md: body(convert(fx.writePdf(dir, { order }), 'md').md),
  }));

  const [reference, ...rest] = outputs;
  for (const other of rest) {
    assert(other.md === reference.md,
      `a page emitted "${other.order}" must convert the same as "${reference.order}"\n` +
      `  ${reference.order}: ${JSON.stringify(reference.md.trim().slice(0, 90))}\n` +
      `  ${other.order}: ${JSON.stringify(other.md.trim().slice(0, 90))}`);
  }

  // And the shared result has to be the document's own order, not merely consistent.
  const text = reference.md.replace(/\s+/g, ' ');
  assert(text.indexOf('Mediation Agreement') < text.indexOf('Case number'),
    'the title must come before the case number');
  assert(text.indexOf('Case number') < text.indexOf('cooperate in good faith'),
    'the case number must come before the body');
}

// --- --pages selects the pages asked for, and only those ---
//
// Byte counts alone would pass an off-by-one, so each page names its own number and
// the assertions read them back.
{
  const pdf = fx.writeMultiPagePdf(dir, 3);
  const text = spec => convert(pdf, 'md', ['--pages', spec]).md.replace(/\s+/g, ' ');

  const one = text('1');
  assert(one.includes('Page 1 of 3'), '--pages 1 must return page 1');
  assert(!one.includes('Page 2') && !one.includes('Page 3'), '--pages 1 must return nothing else');

  const two = text('2');
  assert(two.includes('Page 2 of 3'), '--pages 2 must return page 2, not page 1');
  assert(!two.includes('Page 1') && !two.includes('Page 3'), '--pages 2 must return nothing else');

  const range = text('2-3');
  assert(range.includes('Page 2') && range.includes('Page 3'), 'a range returns its pages');
  assert(!range.includes('Page 1'), 'a range excludes the pages outside it');
  assert(range.indexOf('Page 2') < range.indexOf('Page 3'), 'a range stays in order');

  const list = text('1,3');
  assert(list.includes('Page 1') && list.includes('Page 3'), 'a list returns its pages');
  assert(!list.includes('Page 2'), 'a list excludes the gap');

  // Selecting every page must equal converting the document whole.
  const body = md => md.slice(md.indexOf('---', 3));
  assert(body(convert(pdf, 'md', ['--pages', '1-3']).md) === body(convert(pdf, 'md').md),
    'selecting every page must match converting the whole document');
}

// --- Page shapes that broke real conversions ---
//
// Each of these reproduces a document that got converted wrongly, in the smallest page
// that still poses the problem. They are here because every one of them was found by
// converting a document nobody had tried, and two were re-broken by a later fix.

// An invoice's first table column is headed "#". Read back as Markdown that was an H1
// holding the whole flattened row.
{
  const { md, html } = convert(fx.writeInvoicePdf(dir));
  assert(!/^#\s/m.test(md), 'a "#" the page prints must not open a heading');
  assert(!html.includes('<h1'), 'and must not render as one');
  assert(/^\| # \| Item \| Qty \| Total \|$/m.test(md),
    `the row should read as a table — got ${JSON.stringify(md.match(/^\|.*$/m))}`);
  assert(/^\| 1 \| Consulting \| 1\.00 \| 1,200\.00 \|$/m.test(md),
    'each value should stay under its own heading');
  assert(md.includes('Thank you for your business.'), 'prose must not be swept into the table');
  assert(!/^-\s.*-$/m.test(md), 'a footer written between dashes is not a list item');
}

// Two tickets from one order: the pages are copies of a template, so nearly everything
// repeats. Treating repetition as proof of a header deleted both tickets.
{
  const { md } = convert(fx.writeTicketsPdf(dir));
  assert(md.includes('AAAA-1111') && md.includes('BBBB-2222'), 'both tickets must survive');
  assert(md.includes('Adult admission') && md.includes('Child admission'),
    'and so must what tells them apart');
  assert((md.match(/Payment status/g) || []).length === 2,
    'a line on both pages is the template, not a header to drop');
}

// A letter numbering its sections and its clauses separately reads 1, 1, 2, 3 — and a
// renderer counting from the first number prints 1, 2, 3, 4, shifting every clause.
{
  const { md, html } = convert(fx.writeNumberedPdf(dir));
  const rendered = (html.match(/<p>\s*(\d+)\./g) || []).map(m => m.match(/(\d+)/)[1]);
  assert.deepStrictEqual(rendered, ['1', '1', '2', '3'],
    `the page's own numbering must reach the reader — got ${rendered.join(', ')}`);
  assert(md.includes('1\\. Background'), 'numbering a renderer would change is escaped');
  assert(!html.includes('<ol'), 'so the run is not handed to the renderer to number');
}

// --- --verify reads the page back against the output, and says so on exit ---
//
// Every defect above was mechanically visible in the finished document. Checking by eye
// is what let each one ship, so the check is the tool's own.
{
  const clean = fx.writeInvoicePdf(dir);
  const out = path.join(dir, 'verified');
  const report = execFileSync(process.execPath,
    [CLI, clean, '--format', 'both', '--out-dir', out, '--verify'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

  assert(/lines of page text/.test(report), 'the report says how much page text it read');
  assert(/No text lost, no number changed/.test(report),
    `a good conversion verifies clean — got:\n${report}`);

  // A document whose text cannot all reach the output has to fail loudly, not quietly:
  // a scan has no text layer, so nothing extracted can match the page.
  const plain = convert(clean).md;
  assert(!/MISSING/.test(plain), 'the report does not leak into the document');
}

// --- Provenance is recorded, which is what catches a cross-format overwrite ---
{
  const { md } = convert(fx.writeCsv(dir));
  assert(/^source: "table\.csv"$/m.test(md), 'front-matter should record the source file');
}

// --- Exit codes are a contract for callers in any language (issue #2) ---
{
  let message = '', status = 0;
  try {
    execFileSync(process.execPath, [CLI, path.join(dir, 'nope.docx')],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    message = err.stderr || '';
    status = err.status;
  }
  assert(/No such file/.test(message), `missing input should be named, got: ${message.trim()}`);
  assert(status === 1, `an ordinary failure exits 1, got ${status}`);

  // Scrambled text must be distinguishable from any other failure without
  // parsing stderr, which is what a Python or shell caller needs.
  const reversed = path.join(dir, 'reversed.txt');
  fs.writeFileSync(reversed,
    'םידדצה תומש רושיג ךילהל הסינכ םכסה םיבייחתמ םותב ןוצרמ םכסה\n', 'utf8');

  let visualStatus = 0, visualErr = '';
  try {
    execFileSync(process.execPath, [CLI, reversed, '--format', 'md', '--out-dir', dir],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    visualStatus = err.status;
    visualErr = err.stderr || '';
  }
  assert(visualStatus === 2, `a visual-order rejection exits 2, got ${visualStatus}`);
  assert(/visual order/.test(visualErr), 'the rejection explains itself on stderr');
  assert(!fs.existsSync(path.join(dir, 'reversed.md')), 'nothing is written on rejection');

  // --force overrides it, and then the run succeeds.
  execFileSync(process.execPath,
    [CLI, reversed, '--format', 'md', '--out-dir', dir, '--force'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  assert(fs.existsSync(path.join(dir, 'reversed.md')), '--force writes the output anyway');
}

// A table continued across pages. The column header repeats at the top of each page
// with the first row directly beneath it, so paragraph assembly joins them before
// furniture matching sees the header as a line. It then matches nothing, survives, and
// arrives glued to the front of one row per page — which no check reports, because no
// text was lost. A parser reading the output line by line drops that row.
{
  const statement = fx.writeStatementPdf(dir, 3);
  const { md } = convert(statement, 'md');
  const header = 'Date Description Debit Credit Balance';

  assert(!md.includes(header), 'the repeated column header is dropped, not glued to a row');
  const rows = md.match(/\d{2}\/09\/2026/g) || [];
  assert(rows.length === 15, `every row still reaches the output, got ${rows.length}`);
  assert(/^\s*01\/09\/2026/m.test(md), "and a page's first row starts its own line");
}

// Two columns under a running header that spans the page.
//
// Columns are split only at a gutter no line crosses, and a full-width header crosses
// every candidate — so while the header is still on the page there is no gutter to find
// and the two columns come back interleaved a line at a time, which is the content in
// the wrong order rather than merely the wrong shape. Dropping furniture before the
// page is read leaves the gutter clear. Nothing else pins this, and nothing would
// report it: no text is lost either way.
{
  const { md } = convert(fx.writeRunningHeaderColumnsPdf(dir, 3), 'md');
  const at = text => md.indexOf(text);

  assert(!md.includes('QUARTERLY REPORT'), 'the running header is dropped');

  for (const page of [1, 2, 3]) {
    assert(at(`across the region ${page}`) < at(`South closed one ${page}`),
      `page ${page}: the left column must be read through before the right one starts, ` +
      `not interleaved a line at a time`);
  }
  assert(at('north for the year 1') < at('North opened sites 2'),
    'and a page must be finished before the next one begins');
}

// --- The machine-readable report ---
//
// This is the interface a second tool reads instead of scraping the prose report, so
// what is pinned here is the contract: the fields exist, they are keyed by the page
// numbers a reader would use, and a page's digest answers "is this still the same text"
// across two separate runs. Prose can be reworded freely; this cannot.
{
  const { spawnSync } = require('child_process');
  const pdf = fx.writeMultiPagePdf(dir, 4);
  const out = path.join(dir, 'report-out');

  const run = extra => {
    const result = spawnSync(process.execPath,
      [CLI, pdf, '--format', 'both', '--out-dir', out, ...extra],
      { encoding: 'utf8' });
    assert(result.status === 0, `report run failed (${result.status}): ${result.stderr}`);
    return result;
  };

  const file = path.join(dir, 'report.json');
  run(['--report', file, '--verify']);
  const report = JSON.parse(fs.readFileSync(file, 'utf8'));

  assert(report.schema === 1, 'the report states a schema version to read it by');
  assert(report.tool === 'anydoc' && report.source === path.basename(pdf),
    'the report names the tool and the document it describes');
  assert(report.fromPage === true, 'a PDF was read back from its pages');
  assert(report.passed === true, 'a clean fixture verifies clean');
  assert(Array.isArray(report.pictureOnly), 'pictureOnly is a list even when empty');
  assert(report.totals.pages === 4, `all 4 pages are described, got ${report.totals.pages}`);

  for (const page of report.pages) {
    assert(typeof page.digest === 'string' && page.digest.length,
      `page ${page.page} carries a content digest`);
    assert(typeof page.images === 'number' && typeof page.picture === 'boolean',
      `page ${page.page} states what it drew`);
  }

  // Same bytes in, same digests out — otherwise nothing can be concluded from a change.
  const second = path.join(dir, 'report-2.json');
  run(['--report', second]);
  assert.deepStrictEqual(
    JSON.parse(fs.readFileSync(second, 'utf8')).pages.map(p => p.digest),
    report.pages.map(p => p.digest),
    'a second run of the same document must produce the same per-page digests');

  // Pages differing in content must differ in digest, or the check cannot fail.
  assert(new Set(report.pages.map(p => p.digest)).size === 4,
    'pages with different text must not share a digest');

  // Reported against the page a reader would turn to. These used to be the position in
  // the array, so every finding under --pages pointed at the wrong part of the document.
  const selected = path.join(dir, 'report-pages.json');
  run(['--report', selected, '--pages', '3-4']);
  assert.deepStrictEqual(
    JSON.parse(fs.readFileSync(selected, 'utf8')).pages.map(p => p.page), [3, 4],
    'a page selection reports the document\'s own page numbers, not 1..n');

  // "-" sends the report to stdout, and then stdout holds the report and nothing else:
  // a caller piping this into a parser cannot also be asked to skip past other lines.
  const piped = run(['--report', '-', '--verify']);
  JSON.parse(piped.stdout);
  assert(/Written:/.test(piped.stderr) && /Verified/.test(piped.stderr),
    'everything written for a person goes to stderr instead');

  // A lone "-" is a value. The guard against a missing one used to swallow it.
  const missing = spawnSync(process.execPath, [CLI, pdf, '--report'], { encoding: 'utf8' });
  assert(missing.status === 1 && /--report needs a value/.test(missing.stderr),
    'but an actually missing value is still refused');

  // "-" only means stdout for --report; every other flag it is refused for, the same
  // as a genuinely missing value — accepting it for --out-dir used to create a literal
  // "./-" directory instead.
  const dashOutDir = spawnSync(process.execPath, [CLI, pdf, '--out-dir', '-'], { encoding: 'utf8' });
  assert(dashOutDir.status === 1 && /--out-dir needs a value/.test(dashOutDir.stderr),
    `"-" is only meaningful for --report, not --out-dir: ${dashOutDir.stderr}`);
  assert(!fs.existsSync(path.join(dir, '-')), 'and no literal "-" directory is created');
}

console.log('All integration tests passed.');
