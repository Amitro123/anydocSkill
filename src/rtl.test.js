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

// --pages accepts single pages, ranges and lists, and rejects nonsense
const { _internals: cli } = require('./convert-args');
assert([...cli.parsePageSpec('1')].join() === '1', 'a single page parses');
assert([...cli.parsePageSpec('2-4')].join() === '2,3,4', 'a range expands');
assert([...cli.parsePageSpec('1,5-6')].join() === '1,5,6', 'a list of both parses');
for (const bad of ['0', '3-1', 'x', '']) {
  let threw = false;
  try { cli.parsePageSpec(bad); } catch { threw = true; }
  assert(threw, `"${bad}" must be rejected as a page spec`);
}

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
