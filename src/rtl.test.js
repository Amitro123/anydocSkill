const { addRtlSupport, rtlRatio, detectDocumentLanguage } = require('./rtl');

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
console.assert(rtlRatio(hebrewText) > 0.7, 'Hebrew text should have high RTL ratio');
console.assert(rtlRatio(englishText) < 0.05, 'English text should have low RTL ratio');

// detectDocumentLanguage
const { dir: heDir, lang } = detectDocumentLanguage(hebrewText);
console.assert(heDir === 'rtl', 'Hebrew doc should be RTL');
console.assert(lang === 'he', 'Hebrew doc lang should be "he"');

const { dir: enDir } = detectDocumentLanguage(englishText);
console.assert(enDir === 'ltr', 'English doc should be LTR');

// addRtlSupport output contains expected markers
const output = addRtlSupport(hebrewText, 'Test Doc');
console.assert(output.includes('dir: rtl'), 'front-matter should include dir: rtl');
console.assert(output.includes('lang: he'), 'front-matter should include lang: he');
console.assert(output.includes('<div dir="rtl"'), 'body should be wrapped in RTL div');
console.assert(output.includes('title: "Test Doc"'), 'front-matter should include title');

console.log('All tests passed.');
