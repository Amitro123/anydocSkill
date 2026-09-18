const assert = require('node:assert');
const { addRtlSupport, rtlRatio, detectDocumentLanguage, detectVisualOrder, markRtlLines } = require('./rtl');
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

// markRtlLines — the mark must set direction without breaking Markdown structure
const RLM = '‏';
const markedLines = markRtlLines([
  '# כותרת',
  '- פריט 2024',
  '1. סעיף',
  '> ציטוט',
  '| א | ב |',
  '<div dir="rtl">',
  'plain english',
  '```',
  'const x = "עברית";',
  '```',
].join('\n')).split('\n');

assert(markedLines[0] === `# ${RLM}כותרת`, 'a heading keeps its # at line start');
assert(markedLines[1] === `- ${RLM}פריט 2024`, 'a bullet keeps its marker at line start');
assert(markedLines[2] === `1. ${RLM}סעיף`, 'an ordered item keeps its number at line start');
assert(markedLines[3] === `> ${RLM}ציטוט`, 'a blockquote keeps its marker at line start');
assert(markedLines[4] === '| א | ב |', 'a table row is left alone — a mark before | breaks it');
assert(markedLines[5] === '<div dir="rtl">', 'raw HTML is left alone');
assert(markedLines[6] === 'plain english', 'a line with no RTL letter is left alone');
assert(markedLines[8] === 'const x = "עברית";', 'fenced code is left alone');
assert(markRtlLines('שלום')  === `${RLM}שלום`, 'a bare paragraph is marked at its start');

assert(output.split('\n').some(l => l.startsWith(`# ${RLM}`)),
  'addRtlSupport should mark the body so direction survives without the HTML wrapper');
assert(!addRtlSupport(englishText, { title: 'E' }).includes(RLM), 'LTR output carries no marks');

// promoteHeadings — a hand-formatted document carries its titles as bold body text
const { promoteHeadings } = require('./headings');
const letter = [
  '**הנדון: מצוקת כוח אדם בצהרון**',
  'אנחנו, הורי ילדי גן כרמים, פונים אליכן.',
  '**1. שתי נשות צוות בלבד**',
  'מדובר בילדים בגילאים שונים מאוד.',
  '**לאור כל האמור, אנו מבקשים את התערבותכן הדחופה ואת תגבור הצהרון בסייעת נוספת.**',
  'בתודה מראש,',
  '**הורי גן כרמים**',
].join('\n\n').split(/\n{2,}/);
const promoted = promoteHeadings(letter.join('\n\n')).split(/\n{2,}/);

assert(promoted[0] === '## הנדון: מצוקת כוח אדם בצהרון', 'a bold title becomes a heading');
assert(promoted[2] === '## 1. שתי נשות צוות בלבד', 'a numbered bold title becomes a heading');
assert(promoted[4] === letter[4], 'a bold sentence is emphasis, not a title');
assert(promoted[6] === letter[6], 'bold with no body under it is a sign-off, not a title');
assert(promoted[1] === letter[1] && promoted[5] === letter[5], 'body text is untouched');

assert(promoteHeadings('# כותרת\n\n**מודגש**\n\nגוף') === '# כותרת\n\n**מודגש**\n\nגוף',
  'a document with real headings had styles, so its bold is only emphasis');
assert(promoteHeadings('**חלק **מודגש** ממשפט**\n\nגוף').startsWith('**חלק '),
  'partial emphasis inside a paragraph is never a heading');

// preserveNumbering — a renderer counts a list from its first number, so numbering that
// does not run straight comes out silently renumbered.
const { preserveNumbering } = require('./numbering');

// A demand letter numbers its sections and its clauses separately, so the run reads
// 1, 1, 2, 3 and a renderer would print 1, 2, 3, 4 — shifting every clause it cites.
const letterRun = '1. עובדות\n\n1. ביום 6 במרץ\n\n2. לאחר משא ומתן\n\n3. מועד תחילת העבודה';
assert(preserveNumbering(letterRun) ===
  '1\\. עובדות\n\n1\\. ביום 6 במרץ\n\n2\\. לאחר משא ומתן\n\n3\\. מועד תחילת העבודה',
  'numbering a renderer would change must be escaped, so the page numbers survive');

assert(preserveNumbering('1. אחד\n\n2. שניים\n\n3. שלושה') === '1. אחד\n\n2. שניים\n\n3. שלושה',
  'a run a renderer would number identically stays a list');
assert(preserveNumbering('72. שבעים ושתיים\n\n73. שבעים ושלוש').startsWith('72. '),
  'a list opening at 72 renders from 72, so it needs no escaping');
assert(preserveNumbering('5. חמש\n\nפסקה\n\n6. שש') === '5. חמש\n\nפסקה\n\n6. שש',
  'a paragraph closes the list, so each number opens its own and is rendered as written');
assert(preserveNumbering('2. שתיים\n\n4. ארבע') === '2\\. שתיים\n\n4\\. ארבע',
  'a gap in the sequence would be closed up by the renderer');

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

// "not reversed" and "cannot tell" are different answers, and the second used to be
// reported as the first — so a two-line receipt and an Arabic document passed as clean.
assert(good.judged && bad.judged, 'a few Hebrew words are enough to decide');
assert(!detectVisualOrder('שלום').judged, 'one word is not enough to decide');
assert(!detectVisualOrder('רושיג םכסה').judged, 'nor are two, however reversed they look');
assert(detectVisualOrder('רושיג םכסה ךילהל').reversed,
  'but three reversed words are caught — the old floor of three leading finals was not reached');

const arabic = detectVisualOrder('اتفاق الوساطة بين الطرفين يلتزم الطرفان بالتعاون مع الوسيط');
assert(!arabic.judged && arabic.words === 0,
  'the signal reads Hebrew final forms, so it cannot judge Arabic and must say so');
assert(!englishText.length || !detectVisualOrder(englishText).judged,
  'and it cannot judge a document with no Hebrew in it');

// Front-matter is read back by the overwrite guard and by --ingest consumers, so a
// filename must not be able to break out of a field or forge another one.
const hostile = addRtlSupport(hebrewText, {
  title: 'a" b\nsource: forged.pdf',
  source: 'real: file".pdf',
});
assert(parseFrontMatter(hostile).meta.source === 'real: file".pdf',
  'a quote and a colon in a filename survive the round trip intact');
assert(!/^source: forged\.pdf$/m.test(hostile), 'and a newline cannot inject another key');

// The rendered page is opened, printed and stored, so a document that carries markup
// must not be able to execute it.
const hostileHtml = renderHtml(addRtlSupport(
  'Hello <script>alert(1)</script> and <img src=x onerror=alert(2)>', { title: 'x' }));
assert(!/<script|<img/i.test(hostileHtml.match(/<main>([\s\S]*)<\/main>/)[1]),
  'raw HTML in the source must reach the page as text, never as markup');
assert(hostileHtml.includes('&lt;script&gt;'), 'and is escaped rather than dropped');

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

// PDF structure tree — untagged page furniture is content until it proves repetitive
const page = (blocks, above, below) => ({ blocks, above, below });
const footer = 'עתיד האוטומציה: הדרכות | ייעוץ';

assert(pdfInternals.assemble([page(['גוף'], ['כותרת'], [footer])])
  === `כותרת\n\nגוף\n\n${footer}`,
  'on a one-page extract the strip appears once, so it is content and must be kept');

assert(pdfInternals.assemble([page(['א'], [], [footer]), page(['ב'], [], [footer])])
  === 'א\n\nב',
  'a strip on every page is furniture and must be dropped');

assert(pdfInternals.assemble([page(['א'], [], ['- 1 -']), page(['ב'], [], ['- 2 -'])])
  === 'א\n\n- 1 -\n\nב\n\n- 2 -',
  'page numbers differ per page, so they survive the filter');

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
assert(/^source: "report\.xlsx"$/m.test(sourced), 'front-matter should record the source file');
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
assert(/^source_location: "\.\/docs\/contract\.pdf"$/m.test(ingested), 'ingest records the path');
assert(/^extracted_at: 2026-09-16$/m.test(ingested), 'ingest records the date');
assert(/^content_mode: verbatim$/m.test(ingested), 'this tool only ever extracts verbatim');
assert(ingested.includes('> **Source:** contract.pdf, extracted by anydocSkill on 2026-09-16.'),
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

// An RTL line must be ordered by position, not by the order the producer emitted it.
// Word writes such a line right-to-left; other tools write it left-to-right, and
// trusting array order reverses every word of the second kind.
const { _internals: geo } = require('./pdf-extract');
const ltrEmitted = [                       // ascending x: emitted left-to-right
  { str: 'טוקנים', transform: [0, 0, 0, 11, 462, 365] },
  { str: 'כלכלת',  transform: [0, 0, 0, 11, 716, 365] },
];
assert(geo.joinOneLine(ltrEmitted) === 'כלכלת טוקנים',
  'an RTL line emitted left-to-right must still read right-to-left');

const rtlEmitted = [...ltrEmitted].reverse();   // descending x: already reading order
assert(geo.joinOneLine(rtlEmitted) === 'כלכלת טוקנים',
  'the same line emitted right-to-left must read identically');

// A glyph the page draws that carries no character of its own is lost before anything
// this tool does: it is absent from the extraction and from the output alike, so every
// other check here compares two sides that agree about text neither of them has.
{
  const { verify: v } = { verify: require('./verify') };
  const OPS = { showText: 44, paintImage: 85 };
  const glyphs = list => ({ fnArray: [OPS.showText], argsArray: [[list]] });
  const g = unicode => ({ unicode });

  assert(v._internals.readPage(glyphs([g('ש'), g('ל'), g('ו'), g('ם')]), OPS).unmapped === 0,
    'a page whose glyphs all carry a character reports nothing');
  assert(v._internals.readPage(glyphs([g('1'), g(''), g('0'), g('�')]), OPS).unmapped === 2,
    'a glyph with no character, and one that decoded to the replacement, both count');

  // Positioning adjustments sit in the same array as the glyphs and are not glyphs.
  assert(v._internals.readPage(glyphs([g('א'), -250, g('ב')]), OPS).unmapped === 0,
    'the kerning numbers between glyphs must not be counted as undecoded ones');

  // The verdict has to carry it, or the report would note it under a clean pass.
  const clean = { missing: [], reordered: [], furniture: [], renumbered: [], undecoded: 0 };
  assert(v.passed(clean), 'a conversion with nothing wrong still passes');
  assert(!v.passed({ ...clean, undecoded: 1 }),
    'a single undecoded glyph is text the reader can see and the output cannot hold');
  assert(/UNDECODED/.test(v.report({ ...clean, undecoded: 3, lines: 9, fromPage: true }, { name: 'x' })),
    'and the report names it');

  // Images ride the same pass. A page that draws one and holds no text is a page this
  // cannot read at all — the one case where OCR does better, so it is said plainly.
  const painted = { fnArray: [OPS.paintImage, OPS.showText], argsArray: [[], [[g('א')]]] };
  assert(v._internals.readPage(painted, { ...OPS, paintImageXObject: OPS.paintImage }).images.length === 1,
    'a painted image is counted');
  assert(v.passed({ ...clean, pictures: [3, 4] }),
    'a page that is only a picture does not fail the run — a cover page is not a defect');
  const noted = v.report({ ...clean, pictures: [3, 4], lines: 9, fromPage: true }, { name: 'x' });
  assert(/PICTURE ONLY — page\(s\) 3, 4/.test(noted) && /OCR/.test(noted),
    `but the report names the pages and points at OCR — got:\n${noted}`);
}

// How big an image lands on the page, which is a question only the transformation
// matrix can answer: the image itself is always painted into the unit square.
{
  const v = require('./verify');
  const OPS = {
    showText: 44, save: 10, restore: 11, transform: 12,
    paintImageXObject: 85, paintFormXObjectBegin: 74, paintFormXObjectEnd: 75,
  };
  const A4 = 612 * 792;
  const drawn = (fnArray, argsArray) =>
    v._internals.readPage({ fnArray, argsArray }, OPS, A4).images;

  const [placed] = drawn(
    [OPS.save, OPS.transform, OPS.paintImageXObject, OPS.restore],
    [null, [400, 0, 0, 300, 72, 320], ['img'], null]);
  assert(Math.round(placed.width) === 400 && Math.round(placed.height) === 300,
    `the matrix gives the drawn size, got ${placed.width}x${placed.height}`);
  assert(Math.abs(placed.share - (400 * 300) / A4) < 1e-9, 'and its share of the page');

  // Rotated a quarter turn: the edges swap places but keep their lengths.
  const [turned] = drawn(
    [OPS.transform, OPS.paintImageXObject],
    [[0, 200, -150, 0, 0, 0], ['img']]);
  assert(Math.round(turned.width) === 200 && Math.round(turned.height) === 150,
    `a rotated image keeps its size, got ${turned.width}x${turned.height}`);

  // restore has to undo the transform, or everything after an illustration inherits
  // its scale and the next logo measures the size of a page.
  const [after] = drawn(
    [OPS.save, OPS.transform, OPS.restore, OPS.transform, OPS.paintImageXObject],
    [null, [400, 0, 0, 300, 0, 0], null, [40, 0, 0, 40, 0, 0], ['img']]);
  assert(Math.round(after.width) === 40, `restore must undo the transform, got ${after.width}`);

  // A form XObject with no matrix of its own. pdf.js passes [null, null], and reading
  // that as a matrix is what crashed this on the first real document it met.
  const [inForm] = drawn(
    [OPS.paintFormXObjectBegin, OPS.transform, OPS.paintImageXObject, OPS.paintFormXObjectEnd],
    [[null, null], [50, 0, 0, 50, 0, 0], ['img'], null]);
  assert(Math.round(inForm.width) === 50, 'a form without a matrix is an identity, not a crash');
}

// Which of those images is worth naming. A page that draws one and holds no text is
// already reported whole; the quiet case is a chart or a screenshot among paragraphs,
// where the page reads as ordinary and its words are in neither side of the comparison.
{
  const { _internals: { illustrations, MIN_ILLUSTRATION_SHARE } } = require('./verify');
  const image = (share, at = 0, pixels = { width: 800, height: 600 }) =>
    ({ width: 300, height: 200, x: at, y: at, share, pixels });
  const page = (number, drawn, lines = ['text']) => ({ number, drawn, lines, picture: false });

  const big = MIN_ILLUSTRATION_SHARE + 0.05;
  const small = MIN_ILLUSTRATION_SHARE - 0.05;

  assert(illustrations([page(1, [image(big)])]).length === 1,
    'a large image beside text is named');
  assert(illustrations([page(1, [image(small)])]).length === 0,
    'a small one is not — a report naming every logo is one nobody reads');

  // The same mark in the same place on most pages is a letterhead, whatever its size.
  const everywhere = [1, 2, 3, 4].map(n => page(n, [image(big)]));
  assert(illustrations(everywhere).length === 0,
    'an image repeated across the document is template, not content');

  const once = [page(1, []), page(2, []), page(3, [image(big)]), page(4, [])];
  assert.deepStrictEqual(illustrations(once).map(i => i.page), [3],
    'but one page out of four is content, and is named');

  // A single-page document has nothing to repeat across, and the majority rule must
  // not read its only page as a majority.
  assert(illustrations([page(1, [image(big)])]).length === 1,
    'a one-page document is not its own template');

  const scanned = { number: 1, drawn: [image(0.9)], lines: [], picture: true };
  assert(illustrations([scanned]).length === 0,
    'a page that is only a picture is reported as one, not twice');

  // Size on the page is not the same question as size in pixels. A tint is drawn from
  // a handful of pixels and stretched, and a stretched swatch cannot hold a word.
  const swatch = { width: 2, height: 2 };
  assert(illustrations([page(1, [image(big, 0, swatch)])]).length === 0,
    'a four-pixel swatch stretched across the page holds no words, however large');
  assert(illustrations([page(1, [image(big, 0, null)])]).length === 1,
    'an image that states no resolution is named, not assumed to be a swatch');

  // A different picture drawn into the same frame on each page is how a report is
  // built. Keying on position alone read the whole series as one mark repeating.
  const series = [
    page(1, [image(big, 40, { width: 800, height: 600 })]),
    page(2, [image(big, 40, { width: 640, height: 480 })]),
  ];
  assert(illustrations(series).length === 2,
    'a chart per page in the same frame is a series, not a letterhead');
}

// It is an observation, not a failure: a full-page diagram is not a defect, and only
// the reader knows whether those pages carry anything needed.
{
  const v = require('./verify');
  const clean = { missing: [], reordered: [], furniture: [], renumbered: [], undecoded: 0 };
  const found = [{ page: 4, width: 534, height: 247, share: 0.26 }];
  assert(v.passed({ ...clean, illustrations: found }),
    'an image among text does not fail the run');
  const said = v.report({ ...clean, illustrations: found, lines: 9, fromPage: true }, { name: 'x' });
  assert(/IMAGE AMONG TEXT — a large image sits/.test(said) && /p4: 534x247 pt, 26% of the page/.test(said),
    `but the report names it with its size — got:\n${said}`);
}

// The OCR companion's own argument parsing and its ocrmypdf invocation, both kept in
// src/ocr-args.js purely so this can check them without ocrmypdf installed.
{
  const { parseArgs, pageListArg, buildOcrArgs } = require('./ocr-args');

  const args = parseArgs(['doc.pdf', '--lang', 'heb+eng', '--out-dir', 'out']);
  assert.strictEqual(args.input, 'doc.pdf');
  assert.strictEqual(args.lang, 'heb+eng');
  assert.strictEqual(args.outDir, 'out');
  assert.strictEqual(args.format, 'both', 'the default format matches convert.js\'s own');

  assert.throws(() => parseArgs(['doc.pdf', '--nope']), /Unknown option/,
    'an unrecognised flag is refused rather than silently ignored');
  assert.throws(() => parseArgs(['doc.pdf', '--lang']), /needs a value/);
  assert.throws(() => parseArgs(['a.pdf', 'b.pdf']), /Only one input file/);
  assert.throws(() => parseArgs(['doc.pdf', '--format', 'pdf']), /Unknown --format/);

  assert.strictEqual(pageListArg([3, 7, 9]), '3,7,9');

  const argv = buildOcrArgs('in.pdf', 'out.pdf', [3, 7], 'heb+eng');
  assert(argv.includes('--skip-text'), 'a page that turns out to have text is still left alone');
  assert.deepStrictEqual(argv.slice(argv.indexOf('--pages') + 1, argv.indexOf('--pages') + 2), ['3,7'],
    'restricted to exactly the pages named, not the whole document');
  assert.deepStrictEqual(argv.slice(argv.indexOf('-l') + 1, argv.indexOf('-l') + 2), ['heb+eng']);
  assert(argv[argv.length - 2] === 'in.pdf' && argv[argv.length - 1] === 'out.pdf',
    'input and output are positional and last, as ocrmypdf expects');
}

// reconcile() decides what an OCR pass over anydoc's own output was and was not
// allowed to change. It runs nothing itself, so the whole of its behaviour is here.
{
  const { reconcile, reconcileReport } = require('./reconcile');

  const page = (number, digest, picture = false) => ({ page: number, digest, picture });
  const report = (pages, pictureOnly = []) => ({
    totals: { pages: pages.length },
    pictureOnly,
    pages,
  });

  // The ordinary case: OCR filled in the pages it was asked to and left the rest alone.
  {
    const before = report(
      [page(1, 'aaa'), page(2, 'bbb', true), page(3, 'ccc')],
      [2]);
    const after = report(
      [page(1, 'aaa'), page(2, 'new-text', false), page(3, 'ccc')],
      []);

    const result = reconcile(before, after);
    assert(result.ok, 'a clean OCR pass reconciles');
    assert.deepStrictEqual(result.recovered, [2], 'the OCR page is recorded as recovered');
    assert.deepStrictEqual(result.stillUnreadable, [], 'nothing is left unreadable');
    assert.deepStrictEqual(result.unexpectedChanges, [], 'nothing unexpected happened');
    assert.deepStrictEqual(result.provenance, { 1: 'original', 2: 'ocr', 3: 'original' },
      'each page is attributed to where its text came from');
  }

  // OCR found nothing either. Not a failure of the check — the page is exactly as
  // unreadable as it was, which is a fact worth keeping rather than an error.
  {
    const before = report([page(1, 'aaa'), page(2, 'bbb', true)], [2]);
    const after = report([page(1, 'aaa'), page(2, 'bbb', true)], [2]);

    const result = reconcile(before, after);
    assert(result.ok, 'OCR finding nothing still reconciles cleanly');
    assert.deepStrictEqual(result.stillUnreadable, [2]);
    assert.deepStrictEqual(result.recovered, []);
  }

  // The one thing this exists to catch: a page that already had a text layer came back
  // with a different one. --skip-text and --pages are supposed to make this impossible;
  // this is what actually checks that they did.
  {
    const before = report([page(1, 'aaa'), page(2, 'bbb', true)], [2]);
    const after = report([page(1, 'DIFFERENT'), page(2, 'bbb', true)], [2]);

    const result = reconcile(before, after);
    assert(!result.ok, 'a page that had text and changed anyway must fail reconciliation');
    assert.strictEqual(result.unexpectedChanges.length, 1);
    assert.strictEqual(result.unexpectedChanges[0].page, 1);
    assert(/already had a text layer/.test(result.unexpectedChanges[0].reason));
  }

  // A page count mismatch is refused even with every digest agreeing — the comparison
  // above only checks pages present on both sides, and a missing page would otherwise
  // pass by being absent from both loops.
  {
    const before = report([page(1, 'aaa'), page(2, 'bbb'), page(3, 'ccc')]);
    const after = report([page(1, 'aaa'), page(2, 'bbb')]);

    const result = reconcile(before, after);
    assert(!result.ok, 'a document that lost a page must not reconcile');
    assert(!result.pageCount.match);
    assert.strictEqual(result.pageCount.before, 3);
    assert.strictEqual(result.pageCount.after, 2);
  }

  // A page appearing that was not in the original document — OCR does not add pages,
  // but a silent mismatch here would be harder to trace than a named one.
  {
    const before = report([page(1, 'aaa')]);
    const after = report([page(1, 'aaa'), page(2, 'bbb')]);

    const result = reconcile(before, after);
    assert(!result.ok, 'an extra page must not reconcile');
    assert(result.unexpectedChanges.some(c => c.page === 2 && /not in the original/.test(c.reason)));
  }

  // The report is prose, and has to say the two things that matter: what changed and
  // whether the result is usable.
  {
    const clean = reconcile(
      report([page(1, 'aaa'), page(2, 'bbb', true)], [2]),
      report([page(1, 'aaa'), page(2, 'new', false)], []));
    const said = reconcileReport(clean);
    assert(/OCR added a text layer to 1 page\(s\): 2/.test(said), `got: ${said}`);
    assert(/guess, not a reading/.test(said));

    const refused = reconcile(
      report([page(1, 'aaa')]),
      report([page(1, 'DIFFERENT')]));
    const saidRefused = reconcileReport(refused);
    assert(/REFUSED/.test(saidRefused) && /not being used/.test(saidRefused),
      `a refused result must say so plainly — got: ${saidRefused}`);
  }
}

// --pages accepts single pages, ranges and lists, and rejects nonsense
const { _internals: cli, MAX_PAGE } = require('./convert-args');
const selected = spec => {
  const pick = cli.parsePageSpec(spec);
  return Array.from({ length: 8 }, (_, i) => i + 1).filter(pick.has).join();
};
assert(selected('1') === '1', 'a single page parses');
assert(selected('2-4') === '2,3,4', 'a range covers its members');
assert(selected('1,5-6') === '1,5,6', 'a list of both parses');

for (const bad of ['0', '3-1', 'x', '']) {
  let threw = false;
  try { cli.parsePageSpec(bad); } catch { threw = true; }
  assert(threw, `"${bad}" must be rejected as a page spec`);
}

// A selection is held as intervals, so an oversized range costs a comparison rather
// than the ten million Set entries it used to allocate before the PDF was even opened.
{
  const started = Date.now();
  const huge = cli.parsePageSpec(`1-${MAX_PAGE}`);
  assert(Date.now() - started < 100, 'a range the size of the ceiling must not be expanded');
  assert(huge.has(1) && huge.has(MAX_PAGE) && !huge.has(MAX_PAGE + 1),
    'and still answers membership exactly');

  for (const oversized of [`1-${MAX_PAGE + 1}`, '99999999999999999999']) {
    let message = '';
    try { cli.parsePageSpec(oversized); } catch (err) { message = err.message; }
    assert(/past the highest this reads/.test(message),
      `"${oversized}" must be refused before anything is allocated, got ${JSON.stringify(message)}`);
  }
}

// What the document actually holds is only known once it is open, so the parser reports
// which parts to complain about rather than deciding for itself.
assert(cli.parsePageSpec('2-4,9').beyond(5).join() === '9',
  'a range within the document is kept and one past its end is named, as written');
assert(cli.parsePageSpec('1-3').beyond(10).length === 0, 'nothing to report when all of it fits');

// Repeated text is furniture only while it stays a small part of the document.
const { repeatedFurniture, _internals: { dropRepeatedLines } } = require('./pdf-extract');
const sizes = pages => pages.map(p => p.length);

const withFooter = [
  ['כותרת המסמך', 'פסקה ראשונה', 'עוד טקסט', 'רשימה', 'עתיד האוטומציה'],
  ['המשך המסמך', 'פסקה שנייה', 'סיכום', 'נספח', 'עתיד האוטומציה'],
];
assert([...repeatedFurniture(withFooter, sizes(withFooter))].join() === 'עתיד האוטומציה',
  'a footer repeating on every page is furniture');
assert(!dropRepeatedLines(withFooter).flat().includes('עתיד האוטומציה'),
  'and must be dropped from the output');

// A bank statement whose rows carry a debit/credit flag: the flag column holds the same
// single character on most rows of every page, which counted per page is indistinguishable
// from a footer. It is the only field saying which way the money went, and amounts on the
// statement are unsigned, so dropping it makes a salary and a mortgage look alike.
const flagged = [
  ['תאריך פעולה חובה זכות יתרה',
    'מסטרקרד 16.75', '2', 'מסטרקרד 209.01', '2', 'מסטרקרד 299.00', '2',
    'משכורת 18,449.80', '1', 'קצבת ילדים 276.00', '1', 'זיכוי מלאומי 6,000.00', '1'],
  ['תאריך פעולה חובה זכות יתרה',
    'מקס 17.90', '2', 'הראל 410.71', '2', 'הוראת-קבע 7,900.00', '2',
    'ביטוח לאומי 8,832.00', '1', 'העברה 1,200.00', '1', 'זיכוי בינלאומי 5,000.00', '1'],
];
const flaggedFurniture = repeatedFurniture(flagged, sizes(flagged));
assert(!flaggedFurniture.has('2') && !flaggedFurniture.has('1'),
  'a value repeated down a column of one page is content, however faithfully it repeats');
assert(flaggedFurniture.has('תאריך פעולה חובה זכות יתרה'),
  'while the column header above it is still furniture');
assert(dropRepeatedLines(flagged).flat().filter(text => text === '2').length === 6,
  'so every flag survives');

// A header set at both the top and the bottom of each page is still furniture: twice is
// how a page repeats its own title, not how a table repeats a cell.
const twice = [
  ['נספח א', 'פסקה ראשונה', 'עוד טקסט', 'רשימה', 'הערה', 'נספח א'],
  ['נספח א', 'פסקה שנייה', 'סיכום', 'נספח', 'הפניה', 'נספח א'],
];
assert(repeatedFurniture(twice, sizes(twice)).has('נספח א'),
  'a line repeated twice on a page is still furniture');

// Two tickets from one order: the pages are copies of a template, so almost everything
// repeats and almost none of it is furniture. Dropping it deleted both tickets.
const tickets = [
  ['מס\' כרטיס', 'FC41P', 'סטטוס תשלום', 'שולם', 'זמן ומיקום', '₪59 – ילד'],
  ['מס\' כרטיס', 'FC43C', 'סטטוס תשלום', 'שולם', 'זמן ומיקום', '₪39 – מבוגר'],
];
assert(repeatedFurniture(tickets, sizes(tickets)).size === 0,
  'when most of the page repeats, the repetition is the document, not its furniture');
assert(dropRepeatedLines(tickets).flat().length === 12, 'so every line survives');

assert(repeatedFurniture([['לבד']], [1]).size === 0, 'one page has nothing to repeat against');

// Extracted text is read back as Markdown, so a line opening with a block marker
// grows structure the page never had.
const { escapeBlockMarker } = require('./pdf-extract');

assert(escapeBlockMarker('# מס\' פריט תיאור פריט כמות') === '\\# מס\' פריט תיאור פריט כמות',
  'an invoice column headed # must not become a heading');
assert(escapeBlockMarker('> ציטוט') === '\\> ציטוט', 'a stray > must not become a blockquote');
assert(escapeBlockMarker('- עמוד 1 -') === '\\- עמוד 1 -',
  'a dash on both ends is decoration — no list item closes with its own marker');

assert(escapeBlockMarker('- The Environment') === '- The Environment',
  'a plain dash-prefixed line is the list it looks like and must stay one');
assert(escapeBlockMarker('1. סעיף') === '1. סעיף', 'source numbering is left to render as a list');
assert(escapeBlockMarker('מחיר 1,200.00 #4') === 'מחיר 1,200.00 #4',
  'a marker away from the line start decides nothing and is left alone');

// Tables — a PDF records one as positioned glyphs, so the columns have to be recovered
// from where the cells sit, and recovering them wrongly files a value under the wrong
// heading. Fixtures follow the invoice this was built from: RTL, cells [left..right].
const box = (left, right, str, y) => ({ str, width: right - left, transform: [0, 0, 0, 10, left, y] });

const invoice = [
  [box(569, 575, '#', 542), box(517, 555, 'מס\' פריט', 542), box(419, 465, 'תיאור', 542)],
  [box(569, 575, '1', 526), box(549, 555, '0', 526), box(450, 465, 'יעוץ', 526)],
];
const table = geo.tableAt(invoice, 0, true);
assert(table && table.end === 2, 'two rows of aligned cells are a table');
assert(table.markdown.split('\n')[0] === '| # | מס\' פריט | תיאור |',
  `the rightmost cell leads an RTL table — got ${table && table.markdown.split('\n')[0]}`);
assert(table.markdown.split('\n')[2] === '| 1 | 0 | יעוץ |', 'each value stays under its heading');

// Columns that wander further than they stand apart cannot be told apart.
const ragged = [
  [box(500, 510, 'א', 40), box(450, 460, 'ב', 40), box(400, 410, 'ג', 40)],
  [box(500, 510, 'ד', 20), box(410, 420, 'ה', 20), box(400, 410, 'ו', 20)],
];
assert(geo.tableAt(ragged, 0, true) === null, 'ambiguous columns stay paragraphs');

const shortRow = [invoice[0], [box(569, 575, '1', 526), box(450, 465, 'יעוץ', 526)]];
assert(geo.tableAt(shortRow, 0, true) === null, 'a row of a different width ends the run');
assert(geo.tableAt([invoice[0]], 0, true) === null, 'a header with no data under it is not a table');

// Producers pad a row with whitespace items wide enough to span the gap between columns.
const padded = [box(569, 575, '#', 542), box(556, 568, ' ', 542), box(517, 555, 'מס\'', 542)];
assert(geo.lineToCells(padded, true).length === 2, 'a spacer item must not bridge two cells');

// A tagged table states its columns, so that reading is trusted — unless it holds no
// text, which is how a hand-formatted page positions images.
const content = (id, str) => ({ role: 'TD', children: [{ type: 'content', id }] });
const row = (...cells) => ({ role: 'TR', children: cells.map(([id]) => content(id)) });
const cellItems = new Map([
  ['a', [box(100, 140, 'שם', 50)]], ['b', [box(40, 80, 'סכום', 50)]],
  ['c', [box(100, 140, 'יעוץ', 30)]], ['d', [box(40, 80, '1200', 30)]],
  ['e', [box(100, 140, '', 10)]], ['f', [box(40, 80, '', 10)]],
]);
const tagged = { role: 'Table', children: [row(['a'], ['b']), row(['c'], ['d'])] };
assert(pdfInternals.renderTable(tagged, cellItems, new Set()).split('\n')[2] === '| יעוץ | 1200 |',
  'a tagged table is rendered from its own row and cell tags');

const layout = { role: 'Table', children: [row(['e'], ['f']), row(['e'], ['f'])] };
assert(pdfInternals.renderTable(layout, cellItems, new Set()) === null,
  'a grid holding no text is positioning art, not a table');

// Coverage decides which extraction path a PDF takes, so it has to measure recovered
// text. It used to divide rendered-Markdown length by raw glyph length, putting heading
// hashes and table pipes the page never had into the numerator — the legal letter this
// was built against reported 1.039, a share above everything there was.
{
  const { structuredMarkdown } = require('./pdf-structure');
  const tagged = (id, str, y) => [
    { type: 'beginMarkedContent', id },
    box(40, 90, str, y),
    { type: 'endMarkedContent' },
  ];
  const paragraph = id => ({ role: 'P', children: [{ type: 'content', id }] });

  const all = structuredMarkdown([{
    n: 1,
    tree: { role: 'Document', children: [paragraph('a'), paragraph('b')] },
    items: [...tagged('a', 'ראשון', 90), ...tagged('b', 'שני', 70)],
  }]);
  assert(all.coverage === 1, `a fully tagged page is 1, got ${all.coverage}`);

  const half = structuredMarkdown([{
    n: 1,
    tree: { role: 'Document', children: [paragraph('a')] },
    items: [...tagged('a', 'אאאא', 90), ...tagged('b', 'בבבב', 70)],
  }]);
  assert(half.coverage === 0.5, `half a tagged page is 0.5, got ${half.coverage}`);
  assert(half.coverage < 0.6, 'and falls below the threshold, so the geometry path reads it');

  const untagged = structuredMarkdown([{ n: 1, tree: null, items: [box(40, 90, 'טקסט', 90)] }]);
  assert(untagged.coverage === 0, 'a page with no tree contributes nothing');
}

// An item running past the foot of a page leaves its label behind, so the tail arrives
// tagged LI with an empty Lbl — a bullet there lands in the middle of a sentence.
const item = (lbl, bodyId) => ({
  role: 'LI',
  children: [
    { role: 'Lbl', children: lbl ? [{ type: 'content', id: lbl }] : [] },
    { role: 'LBody', children: [{ type: 'content', id: bodyId }] },
  ],
});
const listItems = new Map([
  ['n9', [box(60, 70, '9.', 90)]],
  ['tail', [box(40, 90, 'אוטומציה', 99)]],
  ['nine', [box(40, 90, 'ביום 27 באוגוסט', 90)]],
]);
const meta = {};
const continued = pdfInternals.renderList(
  { role: 'L', children: [item(null, 'tail'), item('n9', 'nine')] },
  listItems, new Set(), [], meta);

assert(continued[0] === 'אוטומציה', 'a tail with no label is the previous item continuing');
assert(meta.continuesPrevious === true, 'and is flagged so the page before can take it back');
assert(continued[1] === '9. ביום 27 באוגוסט', 'the labelled items after it are unaffected');

// A contract tags its clauses as a list but writes the numbering into the text instead
// of into a Lbl, so every item arrives unlabelled already carrying "4." at the front.
{
  const clause = bodyId => ({ role: 'LI', children: [{ role: 'LBody', children: [{ type: 'content', id: bodyId }] }] });
  const bodies = new Map([
    ['c1', [box(40, 300, '1. המבוא לחוזה זה ונספחיו', 90)]],
    ['c2', [box(40, 300, '2. כותרות הסעיפים הינן לשם נוחות', 70)]],
    ['b1', [box(40, 300, 'שירותי אחזקה שוטפת', 90)]],
    ['b2', [box(40, 300, 'בדיקות תקופתיות', 70)]],
  ]);

  const numbered = pdfInternals.renderList(
    { role: 'L', children: [clause('c1'), clause('c2')] }, bodies, new Set(), [], {});
  assert(numbered.length === 2, 'each self-numbered clause becomes a block of its own');
  assert(numbered[0] === '1. המבוא לחוזה זה ונספחיו',
    `the page's own number is kept and no bullet is added — got ${JSON.stringify(numbered[0])}`);
  assert(!numbered.some(b => b.startsWith('- ')), 'a bullet would be a mark the page does not have');

  // A list that really is unlabelled bullets still gets them: the numbering is what
  // makes the marker redundant, and there is none here.
  const bullets = pdfInternals.renderList(
    { role: 'L', children: [clause('b1'), clause('b2')] }, bodies, new Set(), [], {});
  assert(bullets.length === 1 && bullets[0] === '- שירותי אחזקה שוטפת\n- בדיקות תקופתיות',
    `an unlabelled list with no numbering of its own stays a bullet list — got ${JSON.stringify(bullets)}`);
}

const split = [{ blocks: ['...הועסק כמפתח'] }, { blocks: ['אוטומציה — היכן'], continuesPrevious: true }];
pdfInternals.rejoinAcrossPages(split);
assert(split[0].blocks[0] === '...הועסק כמפתח אוטומציה — היכן', 'the sentence is put back together');
assert(split[1].blocks.length === 0, 'and is not left behind on the next page too');

// A page must be assembled by position too: one producer emitted a newsletter's
// middle section first, then its footer, then its header.
const line = (y, str) => [{ str, transform: [0, 0, 0, 11, 100, y] }];
// Paragraph splitting depends on gap sizes that a three-line fixture cannot model,
// so this asserts the sequence the text comes out in, which is what the fix governs.
const sequence = lines => geo.linesToParagraphs(lines).join(' ').split(/\s+/).join('|');

const outOfOrder = [line(1842, 'אמצע'), line(6, 'תחתית'), line(5201, 'ראש')];
assert(sequence(outOfOrder) === 'ראש|אמצע|תחתית',
  `lines must be placed by y, not by emission order — got ${sequence(outOfOrder)}`);

const inOrder = [line(5201, 'ראש'), line(1842, 'אמצע'), line(6, 'תחתית')];
assert(sequence(inOrder) === 'ראש|אמצע|תחתית',
  'a page already emitted top to bottom is unchanged');

// A page with columns is read a column at a time. Sorting the whole page by y
// interleaves them, which put a Google Docs sidebar's contents through the body.
const at = (x, w, y, str) => [{ str, width: w, transform: [0, 0, 0, 11, x, y] }];

const twoColumns = [
  at(350, 393, 413, 'גוף-א'), at(543, 202, 377, 'גוף-ב'),   // body, right
  at(173,  59, 419, 'צד-א'),  at(142,  54, 388, 'צד-ב'),    // sidebar, left
];
assert(sequence(twoColumns) === 'גוף-א|גוף-ב|צד-א|צד-ב',
  `RTL columns read right first, each top to bottom — got ${sequence(twoColumns)}`);

// The same geometry in an LTR document reads the other way round.
const ltrColumns = [
  at(350, 393, 413, 'body-a'), at(543, 202, 377, 'body-b'),
  at(173,  59, 419, 'side-a'), at(142,  54, 388, 'side-b'),
];
assert(geo.linesToParagraphs(ltrColumns).join(' ').split(/\s+/).join('|')
       === 'side-a|side-b|body-a|body-b',
  'LTR columns read left first');

// Single-column pages must not be split: wide lines leave no gutter to find.
const oneColumn = [
  at(100, 600, 700, 'שורה-א'), at(100, 600, 680, 'שורה-ב'),
  at(100, 600, 660, 'שורה-ג'), at(100, 600, 640, 'שורה-ד'),
];
assert(geo.findGutter(oneColumn) === null, 'a single column has no gutter');
assert(sequence(oneColumn) === 'שורה-א|שורה-ב|שורה-ג|שורה-ד', 'a single column stays in y order');

// An indented line is not a column either.
const indented = [
  at(100, 600, 700, 'רגילה'), at(140, 560, 680, 'מוזחת'), at(100, 600, 660, 'רגילה2'),
];
assert(geo.findGutter(indented) === null, 'an indent must not be read as a column');

// A lone item off in the margin — a page number, a stamp — sits behind a clean
// gutter but is not a column. This is what MIN_COLUMN_LINES is for: without it the
// page splits in two and the margin note is read as a section of its own.
const marginNote = [
  at(300, 400, 700, 'גוף-1'), at(300, 400, 680, 'גוף-2'), at(300, 400, 660, 'גוף-3'),
  at(100,  50, 690, '7'),
];
assert(geo.findGutter(marginNote) === null,
  'one line beside the body is a margin note, not a column');
assert(sequence(marginNote) === 'גוף-1|7|גוף-2|גוף-3',
  'a margin note stays where its y puts it');

console.log('All tests passed.');
