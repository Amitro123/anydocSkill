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
const output = addRtlSupport(hebrewText, 'Test Doc');
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
const ltrHtml = renderHtml(addRtlSupport(englishText, 'English Doc'));
assert(ltrHtml.includes('<html dir="ltr" lang="en">'), 'English doc should render LTR');

// renderHtml — tables get a scroll container
const tableHtml = renderHtml(addRtlSupport('| א | ב |\n|---|---|\n| 1 | 2 |', 'T'));
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

console.log('All tests passed.');
