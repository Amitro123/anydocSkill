/**
 * Argument parsing that the tests exercise directly, kept out of convert.js so
 * requiring it does not run the CLI.
 */

/**
 * The largest page number a selection may name.
 *
 * No document has this many pages, so a selection naming one is a typo or a hostile
 * argument rather than a document — and the answer is the same either way. The point of
 * the ceiling is that it is checked here, before the PDF is opened, so a bad argument
 * costs a message rather than a page-count lookup. It also puts every endpoint well
 * inside safe-integer range, so the arithmetic below cannot drift.
 */
const MAX_PAGE = 100000;

/**
 * A page selection, held as intervals rather than as the pages themselves.
 *
 * Expanding `2-4` into its members is fine; expanding `1-10000000` is not, and nothing
 * in the spec says which one is coming. The set used to be built here, before the PDF
 * was open and its real page count known, so a single oversized argument allocated ten
 * million entries and spent seconds doing it for a document with four pages. Membership
 * is a comparison against a handful of intervals instead, which costs nothing whatever
 * the spec asks for.
 */
function selection(ranges) {
  return {
    ranges,
    has: n => ranges.some(range => n >= range.from && n <= range.to),
    // The parts that name a page the document turned out not to have, as written.
    beyond: pageCount => ranges.filter(r => r.to > pageCount).map(r => r.label),
  };
}

/**
 * Parse a page selection like "1", "2-4" or "1,5-7".
 *
 * Pages are 1-indexed to match how a reader refers to them. What the document actually
 * holds is not known yet, so this checks only what it can — the shape, the direction of
 * a range, and the ceiling — and `beyond()` does the rest once the PDF is open.
 *
 * @param {string} spec
 * @returns {{ranges: object[], has: (n: number) => boolean, beyond: (pageCount: number) => string[]}}
 */
function parsePageSpec(spec) {
  if (!spec) throw new Error('--pages needs a value, for example 1 or 2-4 or 1,5-7');

  const ranges = [];
  for (const part of spec.split(',')) {
    const label = part.trim();
    const range = label.match(/^(\d+)(?:-(\d+))?$/);
    if (!range) throw new Error(`Cannot read "${label}" as a page or range.`);

    const from = Number(range[1]);
    const to = range[2] === undefined ? from : Number(range[2]);

    if (from < 1) throw new Error('Pages are numbered from 1.');
    if (to < from) throw new Error(`Range "${label}" ends before it starts.`);
    if (to > MAX_PAGE) {
      throw new Error(
        `"${label}" names page ${to}, past the highest this reads (${MAX_PAGE}). ` +
        `Check the range — no document is that long.`
      );
    }
    ranges.push({ from, to, label });
  }
  return selection(ranges);
}

module.exports = { parsePageSpec, MAX_PAGE, _internals: { parsePageSpec, selection } };
