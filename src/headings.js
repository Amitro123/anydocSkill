/**
 * Promote fully bold paragraphs to headings.
 *
 * A document formatted by hand carries no heading styles, so every path here returns
 * its section titles as bold body text — the structure tree tags them P, the
 * firecrawl/anydoc extractor emits `**...**`, the geometry path sees only a short
 * line. The words survive and the shape is lost: nothing to navigate by, no outline,
 * and anything reading the Markdown sees one flat run of paragraphs.
 *
 * Bold alone does not make a heading, though. A letter emphasises whole paragraphs for
 * weight and signs off in bold, and promoting those would invent an outline the
 * document does not have. A title is also short, is a label rather than a sentence,
 * and has the body it introduces underneath it — so all of that has to hold.
 */

const MAX_LENGTH = 80;         // longer than this is an emphasised paragraph, not a title
const SENTENCE_END = /[.!?]$/; // a title is a label; a bold sentence is emphasis
const ATX_HEADING = /^#{1,6}\s/m;

// Bold running the whole way across, with no emphasis of its own inside.
function boldOnly(block) {
  const match = block.trim().match(/^\*\*([^*]+)\*\*$/);
  return match ? match[1].trim() : null;
}

/**
 * @param {string} markdown - Extracted Markdown
 * @returns {string} The same Markdown with bold section titles raised to `##`
 */
function promoteHeadings(markdown) {
  // Real heading styles in the source mean the author did use them, so bold here is
  // only ever emphasis.
  if (ATX_HEADING.test(markdown)) return markdown;

  const blocks = markdown.split(/\n{2,}/);

  return blocks.map((block, i) => {
    const text = boldOnly(block);
    if (!text || text.length > MAX_LENGTH || SENTENCE_END.test(text)) return block;

    // A heading introduces something. Bold with no body under it is a sign-off.
    const next = (blocks[i + 1] || '').trim();
    if (!next || boldOnly(next)) return block;

    return `## ${text}`;
  }).join('\n\n');
}

module.exports = { promoteHeadings, _internals: { boldOnly } };
