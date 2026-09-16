const assert = require('node:assert');
const { addRtlSupport, rtlRatio, detectDocumentLanguage, detectVisualOrder } = require('./rtl');
const { renderHtml, parseFrontMatter } = require('./render-html');

const hebrewText = `
# הסכם כניסה להליך גישור

הצדדים לגישור מתחייבים לשתף פעולה עם המגשרת.

המגשרת תשמור בסודיות על הצדדים בהליך גישור.
`.trim();

const englishText = `
# Agreement

The parties agree to cooperate with the mediator in good faith.
`.trim();

// RTL ratio
assert(rtlRatio(hebrewText) > 0.7, 'Hebrew text should have high RTL ratio');
assert(rtlRatio(englishText) < 0.05, 'English text should have low RTL ratio');

// detectDocumentLanguage
const { dir: heDir, lang } = detectDocumentLanguage(hebrewText);
assert(heDir === 'rtl', 'Hebrew doc should be RTL');
assert(lang === 'he', 'Hebrew doc lang should be "he"');

const { dir: enDir } = detectDocumentLanguage(englishText);
assert(enDir === 'ltr', 'English doc should be LTR');

// addRtlSupport output contains expected markers
const output = addRtlSupport(hebrewText, { title: 'Test Doc' });
assert(output.includes('dir: rtl'), 'front-matter should include dir: rtl');
assert(output.includes('lang: he'), 'front-matter should include lang: he');
assert(output.includes('<div dir="rtl"'), 'body should be wrapped in RTL div');
assert(output.includes('title: "Test Doc"'), 'front-matter should include title');

// parseFrontMatter
const parsed = parseFrontMatter(output);
assert(parsed.meta.dir === 'rtl', 'front-matter dir should parse');
assert(parsed.meta.lang === 'he', 'front-matter lang should parse');
assert(parsed.meta.title === 'Test Doc', 'quoted title should unquote');
assert(!parsed.body.startsWith('---'), 'body should have front-matter stripped');

// renderHtml — direction must live on <html>, not only in CSS
const html = renderHtml(output);
assert(html.includes('<html dir="rtl" lang="he">'), 'html tag should carry dir and lang');
assert(html.includes('<title>Test Doc</title>'), 'title should render');
assert(html.includes('<h1'), 'markdown headings should render as HTML');
assert(!html.includes('<div dir="rtl"'), 'redundant rtl div should be unwrapped');

// renderHtml — LTR documents stay LTR
const ltrHtml = renderHtml(addRtlSupport(englishText, { title: 'English Doc' }));
assert(ltrHtml.includes('<html dir="ltr" lang="en">'), 'English doc should render LTR');

// renderHtml — tables get a scroll container
const tableHtml = renderHtml(addRtlSupport('| א | ב |\n|---|---|\n| 1 | 2 |', { title: 'T' }));
assert(tableHtml.includes('<div class="table-scroll"><table>'), 'tables should be wrapped');

// detectVisualOrder — catches extractors that emit RTL text word-reversed
const good = detectVisualOrder('שמות הצדדים הסכם כניסה להליך גישור מתחייבים בתום');
assert(!good.reversed, 'correct Hebrew should not be flagged as reversed');
assert(good.trailing > good.leading, 'correct Hebrew ends words with final forms');

const bad = detectVisualOrder('םידדצה תומש רושיג ךילהל הסינכ םכסה םיבייחתמ םותב');
assert(bad.reversed, 'reversed Hebrew should be flagged');
assert(bad.leading > bad.trailing, 'reversed Hebrew starts words with final forms');

assert(!detectVisualOrder(englishText).reversed, 'English must never be flagged');
assert(!detectVisualOrder('שלום').reversed, 'a short sample must not trip the detector');

// detectDocumentLanguage — a bilingual deck is still Hebrew, not "und"
const bilingual = 'מבנה ארגוני טכנולוגיות מנהלת פיתוח מנהל תשתיות Head of BI מובילי AI עופר נאור';
const bi = detectDocumentLanguage(bilingual);
assert(bi.dir === 'rtl', 'Hebrew-majority text with Latin terms should be RTL');
assert(bi.lang === 'he', `mixed Hebrew/Latin should resolve to he, got ${bi.lang}`);

// pptx — page furniture must not leak into slide text
const { _internals } = require('./pptx-extract');
const slideXml = `<p:sp><p:nvSpPr><p:ph type="title"/></p:nvSpPr>` +
  `<a:p><a:r><a:t>מערכות מידע</a:t></a:r></a:p></p:sp>` +
  `<p:sp><p:nvSpPr><p:ph type="sldNum"/></p:nvSpPr>` +
  `<a:p><a:fld><a:t>2</a:t></a:fld></a:p></p:sp>`;
const slideParas = _internals.xmlToParagraphs(slideXml);
assert(slideParas.includes('מערכות מידע'), 'slide title should be extracted');
assert(!slideParas.includes('2'), 'slide-number placeholder must be dropped');

// pptx — runs inside one paragraph join without a gap, entities decode
const runXml = '<a:p><a:r><a:t>BI</a:t></a:r><a:r><a:t> &amp; AI</a:t></a:r></a:p>';
assert(_internals.xmlToParagraphs(runXml)[0] === 'BI & AI', 'runs should join and unescape');

// PDF structure tree — list runs must never let Markdown renumber a document
const { _internals: pdfInternals } = require('./pdf-structure');
const runShape = labels =>
  pdfInternals.labelRuns(labels.map(label => ({ label, body: 'x' })))
    .map(r => `${r.ordered ? 'ol' : 'ul'}:${r.entries.length}`).join(' ');

assert(runShape(['1', '2', '3']) === 'ol:3', 'a plain sequence is one ordered list');
assert(runShape(['', '1', '2', '3']) === 'ul:1 ol:3',
  'an unlabelled option must not absorb the numbered clauses after it');
assert(runShape(['1', '2', '1', '2']) === 'ol:2 ol:2',
  'a restarted sequence must split, never renumber');
assert(runShape(['1', '2', '5']) === 'ol:2 ol:1',
  'a gap in numbering must split so 5 stays 5');
assert(runShape(['א', 'ב']) === 'ul:2', 'non-numeric labels stay bullets');

assert(pdfInternals.numericLabel('1.') === 1, 'a trailing period is part of the label');
assert(pdfInternals.numericLabel('2 )') === 2, 'spacing inside a label is tolerated');
assert(pdfInternals.numericLabel('א') === null, 'a Hebrew letter is not a number');

// PDF geometry — an embedded LTR run must survive an RTL line
const { reorderLtrRuns } = require('./pdf-extract');
const caseNumber = [
  { str: '26', transform: [0, 0, 0, 11, 454, 100] },
  { str: '-', transform: [0, 0, 0, 11, 450, 100] },
  { str: '01', transform: [0, 0, 0, 11, 439, 100] },
  { str: '-', transform: [0, 0, 0, 11, 435, 100] },
  { str: '123456', transform: [0, 0, 0, 11, 403, 100] },
];
assert(reorderLtrRuns(caseNumber).map(i => i.str).join('') === '123456-01-26',
  'a hyphenated number split across items must read left-to-right');

const mixed = [
  { str: 'תיק', transform: [0, 0, 0, 11, 467, 100] },
  { str: '15', transform: [0, 0, 0, 11, 454, 100] },
  { str: 'ימים', transform: [0, 0, 0, 11, 430, 100] },
];
assert(reorderLtrRuns(mixed).map(i => i.str).join(' ') === 'תיק 15 ימים',
  'Hebrew around a lone number keeps its order');

// front-matter records provenance, which is what detects a cross-format overwrite
const sourced = addRtlSupport(hebrewText, { title: 'Doc', source: 'report.xlsx' });
assert(/^source: report\.xlsx$/m.test(sourced), 'front-matter should record the source file');
assert(!/source:/.test(addRtlSupport(hebrewText, { title: 'Doc' })), 'source omitted when not given');

// --ingest metadata (issue #1)
const plain = addRtlSupport(hebrewText, { title: 'Doc', source: 'a.pdf' });
assert(!/source_type|extracted_at|content_mode/.test(plain), 'ingest fields are opt-in');
assert(!/\*\*Source:\*\*/.test(plain), 'the source notice is opt-in');

const ingested = addRtlSupport(hebrewText, {
  title: 'Doc', source: 'contract.pdf',
  ingest: { type: 'pdf', location: './docs/contract.pdf', extractedAt: '2026-09-16' },
});
assert(/^source_type: pdf$/m.test(ingested), 'ingest records the source type');
assert(/^source_location: \.\/docs\/contract\.pdf$/m.test(ingested), 'ingest records the path');
assert(/^extracted_at: 2026-09-16$/m.test(ingested), 'ingest records the date');
assert(/^content_mode: verbatim$/m.test(ingested), 'this tool only ever extracts verbatim');
assert(ingested.includes('> **Source:** contract.pdf, extracted by anydoceSkill on 2026-09-16.'),
  'ingest adds the source notice');
assert(ingested.indexOf('> **Source:**') < ingested.indexOf('<div dir="rtl"'),
  'the notice is provenance, so it sits outside the RTL wrapper');

// Slide notes carry their slide number (issue #4)
const notesMd = [
  '---', 'dir: rtl', 'lang: he', '---', '',
  '<div dir="rtl" lang="he">', '',
  '## שקופית 4', '',
  '<!-- Slide 4 notes -->', '> **הערות דובר:** להזכיר את התקציב', '',
  '</div>',
].join('\n');
const notesHtml = renderHtml(notesMd);
assert(/<aside data-slide="4" dir="rtl">/.test(notesHtml), 'notes become an addressable aside');
assert(!/<!-- Slide 4 notes -->/.test(notesHtml), 'the marker is consumed, not left in the output');
assert(notesHtml.includes('להזכיר את התקציב'), 'notes content survives the rewrite');
assert(!/<blockquote>[\s\S]*הערות דובר/.test(notesHtml), 'the blockquote is replaced, not duplicated');

// pptx labels follow the deck, so an English deck is not labelled in Hebrew
const { _internals: pptxInternals } = require('./pptx-extract');
assert(pptxInternals.LABELS.en.slide(3) === 'Slide 3', 'English decks use English labels');
assert(pptxInternals.LABELS.he.slide(3) === 'שקופית 3', 'Hebrew decks keep Hebrew labels');

console.log('All tests passed.');
