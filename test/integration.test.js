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

function convert(input, format = 'both') {
  const out = path.join(dir, 'out', path.basename(input).replace(/\W/g, '_'));
  execFileSync(process.execPath, [CLI, input, '--format', format, '--out-dir', out],
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

// --- Provenance is recorded, which is what catches a cross-format overwrite ---
{
  const { md } = convert(fx.writeCsv(dir));
  assert(/^source: table\.csv$/m.test(md), 'front-matter should record the source file');
}

// --- A missing input fails clearly rather than surfacing a raw io error ---
{
  let message = '';
  try {
    execFileSync(process.execPath, [CLI, path.join(dir, 'nope.docx')],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    message = err.stderr || '';
  }
  assert(/No such file/.test(message), `missing input should be named, got: ${message.trim()}`);
}

fs.rmSync(dir, { recursive: true, force: true });
console.log('All integration tests passed.');
