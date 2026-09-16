/**
 * RTL post-processing for extracted Markdown, whichever path produced it.
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
const isHebrewChar = ch => ch.codePointAt(0) >= 0x0590 && ch.codePointAt(0) <= 0x05ff;

// Below this many Hebrew words the tallies are noise: a single word that happens to end
// in a final form decides the answer on its own.
const MIN_SAMPLE = 3;

/**
 * Detect Hebrew captured in visual order (each word character-reversed).
 *
 * The signal reads final forms, so it is Hebrew by construction — no other script has
 * them — and it needs a few words before the counts mean anything. Both limits are
 * reported instead of being folded into `reversed`, because "not reversed" and "cannot
 * tell" are different answers and only one of them is safe to act on. A two-line
 * receipt and an Arabic document both land in the second, and used to be reported as
 * the first.
 *
 * @returns {{reversed: boolean, judged: boolean, leading: number, trailing: number, words: number}}
 */
function detectVisualOrder(text) {
  let leading = 0, trailing = 0, words = 0;

  for (const word of text.split(/\s+/)) {
    const letters = [...word].filter(isHebrewChar);
    if (letters.length < 2) continue;
    words++;
    if (HEBREW_FINALS.has(letters[0])) leading++;
    if (HEBREW_FINALS.has(letters[letters.length - 1])) trailing++;
  }

  const judged = words >= MIN_SAMPLE;
  return { reversed: judged && leading > trailing, judged, leading, trailing, words };
}

const RLM = '‏';  // U+200F RIGHT-TO-LEFT MARK
const RTL_LETTER = /[֐-׿؀-ۿݐ-ݿ]/;
// A leading marker Markdown reads structurally: a mark placed before it stops it parsing.
const MARKDOWN_MARKER = /^(\s*(?:[-*+]|\d+\\?[.)]|#{1,6}|>)\s+)?/;

/**
 * Force RTL base direction line by line with U+200F.
 *
 * Markdown has no direction of its own. The dir="rtl" wrapper reaches only renderers
 * that keep raw HTML and do not sanitise the attribute away; a plain editor, a GitHub
 * preview or most viewers fall back to LTR, which left-aligns the text and strands
 * digits and Latin runs on the wrong side of any line that does not open with a Hebrew
 * letter. An RLM makes the Unicode first-strong rule resolve the line to RTL with no
 * HTML at all, so both kinds of renderer read correctly.
 */
function markRtlLines(markdown) {
  let inFence = false;

  return markdown.split('\n').map(line => {
    if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; return line; }
    // Table rows and raw HTML break if anything precedes their first character, and a
    // line with no RTL letter has nothing for the mark to reorder.
    if (inFence || /^\s*[|<]/.test(line) || !RTL_LETTER.test(line)) return line;

    return line.replace(MARKDOWN_MARKER, `$&${RLM}`);
  }).join('\n');
}

/**
 * Add RTL front-matter and wrap RTL paragraphs.
 *
 * @param {string} markdown - Extracted Markdown
 * @param {object} [opts]
 * @param {string} [opts.title] - Document title
 * @param {string} [opts.source] - Original filename, recorded for provenance
 * @param {object} [opts.ingest] - Knowledge-base metadata; see ingestFields
 * @returns {string} RTL-enhanced Markdown
 */
function addRtlSupport(markdown, opts = {}) {
  const { title = '', source = '', ingest = null } = opts;
  const { dir, lang } = detectDocumentLanguage(markdown);

  const frontMatter = [
    '---',
    title ? yamlField('title', title) : null,
    source ? yamlField('source', source) : null,
    ...ingestFields(ingest),
    `dir: ${dir}`,
    lang ? `lang: ${lang}` : null,
    '---',
  ].filter(Boolean).join('\n');

  // The notice sits outside the RTL wrapper: it is provenance about the document
  // rather than part of it, and it is written in English.
  const notice = ingest
    ? `\n> **Source:** ${source || ingest.location}, extracted by anydocSkill on ${ingest.extractedAt}.\n`
    : '';

  const body = dir === 'ltr'
    ? markdown
    : `<div dir="rtl" lang="${lang || 'he'}">\n\n${markRtlLines(markdown.trim())}\n\n</div>`;

  return `${frontMatter}\n${notice}\n${body}`;
}

// Only ever "verbatim": this tool extracts, it never summarises. The field is still
// written so a knowledge base mixing extracts with generated summaries can tell them
// apart without inspecting the text.
function ingestFields(ingest) {
  if (!ingest) return [];
  return [
    `source_type: ${ingest.type}`,
    yamlField('source_location', ingest.location),
    `extracted_at: ${ingest.extractedAt}`,
    'content_mode: verbatim',
  ];
}

/**
 * Emit one front-matter field, quoted so no value can break out of it.
 *
 * A filename can hold a quote, a colon or a newline, and a field built by interpolation
 * then either corrupts the block or injects a key of its own. `--ingest` exists to make
 * a stored document self-describing and the overwrite guard reads `source:` back out,
 * so a field a filename can forge defeats both. JSON string syntax is valid YAML, which
 * makes the escaping someone else's solved problem.
 */
const yamlField = (key, value) => `${key}: ${JSON.stringify(String(value))}`;

module.exports = { addRtlSupport, rtlRatio, detectDocumentLanguage, detectVisualOrder, markRtlLines };
