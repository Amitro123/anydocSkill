/**
 * RTL post-processing for anydoc Markdown output.
 * Detects Hebrew/Arabic text and wraps paragraphs with dir="rtl".
 */

const RTL_THRESHOLD = 0.3; // fraction of RTL chars that triggers RTL wrapping

function isRtlChar(ch) {
  const cp = ch.codePointAt(0);
  return (cp >= 0x0590 && cp <= 0x05ff) || // Hebrew
         (cp >= 0x0600 && cp <= 0x06ff) || // Arabic
         (cp >= 0x0750 && cp <= 0x077f) || // Arabic Supplement
         (cp >= 0xfb1d && cp <= 0xfdff) || // Hebrew/Arabic Presentation Forms
         (cp >= 0xfe70 && cp <= 0xfeff);   // Arabic Presentation Forms-B
}

function rtlRatio(text) {
  const letters = [...text].filter(c => /\p{L}/u.test(c));
  if (letters.length === 0) return 0;
  return letters.filter(isRtlChar).length / letters.length;
}

function detectDocumentLanguage(markdown) {
  if (rtlRatio(markdown) <= RTL_THRESHOLD) return { dir: 'ltr', lang: null };
  // Once the base direction is RTL, Hebrew vs Arabic is a straight comparison of
  // script counts — mixed-in Latin (tech terms, brand names) does not affect it.
  return { dir: 'rtl', lang: detectScript(markdown) };
}

function detectScript(text) {
  const hebrewCount = [...text].filter(c => {
    const cp = c.codePointAt(0);
    return cp >= 0x0590 && cp <= 0x05ff;
  }).length;
  const arabicCount = [...text].filter(c => {
    const cp = c.codePointAt(0);
    return cp >= 0x0600 && cp <= 0x06ff;
  }).length;
  if (hebrewCount > arabicCount) return 'he';
  if (arabicCount > 0) return 'ar';
  return 'und';
}

// Hebrew final forms (sofit) occur only as the last letter of a word. Text captured
// in visual rather than logical order reverses each word, so they surface at the front
// instead — a near-deterministic signal that an extractor mangled the text.
const HEBREW_FINALS = new Set(['ך', 'ם', 'ן', 'ף', 'ץ']);

/**
 * Detect Hebrew captured in visual order (each word character-reversed).
 * @returns {{reversed: boolean, leading: number, trailing: number}}
 */
function detectVisualOrder(text) {
  let leading = 0, trailing = 0;

  for (const word of text.split(/\s+/)) {
    const letters = [...word].filter(isRtlChar);
    if (letters.length < 2) continue;
    if (HEBREW_FINALS.has(letters[0])) leading++;
    if (HEBREW_FINALS.has(letters[letters.length - 1])) trailing++;
  }

  return { reversed: leading > trailing && leading > 2, leading, trailing };
}

/**
 * Add RTL front-matter and wrap RTL paragraphs.
 * @param {string} markdown - Raw Markdown from anydoc
 * @param {string} [title] - Optional document title
 * @returns {string} RTL-enhanced Markdown
 */
function addRtlSupport(markdown, title = '') {
  const { dir, lang } = detectDocumentLanguage(markdown);

  const frontMatter = [
    '---',
    title ? `title: "${title}"` : null,
    `dir: ${dir}`,
    lang && lang !== 'und' ? `lang: ${lang}` : null,
    '---',
  ].filter(Boolean).join('\n');

  if (dir === 'ltr') {
    return `${frontMatter}\n\n${markdown}`;
  }

  // Wrap the whole body in a single RTL div (simpler and more reliable than per-paragraph)
  const body = `<div dir="rtl" lang="${lang || 'he'}">\n\n${markdown.trim()}\n\n</div>`;
  return `${frontMatter}\n\n${body}`;
}

module.exports = { addRtlSupport, rtlRatio, detectDocumentLanguage, detectVisualOrder };
