/**
 * Keep a document's own numbering.
 *
 * Extracted numbering arrives as ordinary text — `12.` at the head of a line — and that
 * is valid Markdown, so a renderer takes the list over and numbers it itself. It only
 * honours the number a list opens with; everything after is counted from there. A
 * document whose numbering does not run 1, 2, 3 therefore comes out silently
 * renumbered, and numbering that does not run straight is the norm: a letter numbering
 * its sections and its clauses separately, a contract restarting under each head, a
 * form skipping a reserved number.
 *
 * Renumbering a legal document changes what it says — its clauses are cross-referenced
 * by number, inside the document and outside it. So a run stays a list only when the
 * renderer would arrive at the same numbers; otherwise its numbering is escaped and
 * reads exactly as the page does.
 */

const NUMBERED = /^(\s*)(\d+)([.)])(?=\s)/;
const FENCE = /^\s*(```|~~~)/;

/**
 * @param {string} markdown - Extracted Markdown
 * @returns {string} The same Markdown, with numbering a renderer would change escaped
 */
function preserveNumbering(markdown) {
  const lines = markdown.split('\n');
  const runs = [];
  let run = null;
  let inFence = false;

  lines.forEach((line, i) => {
    if (FENCE.test(line)) { inFence = !inFence; run = null; return; }
    if (inFence) return;

    const match = line.match(NUMBERED);
    if (match) {
      if (!run) runs.push(run = []);
      run.push({ index: i, number: Number(match[2]) });
    } else if (line.trim()) {
      // Anything else between items closes the list; the next number opens a new one.
      run = null;
    }
  });

  const out = [...lines];
  for (const items of runs) {
    const asRendered = items.every((item, k) => item.number === items[0].number + k);
    if (asRendered) continue;
    for (const { index } of items) out[index] = lines[index].replace(NUMBERED, '$1$2\\$3');
  }
  return out.join('\n');
}

module.exports = { preserveNumbering };
