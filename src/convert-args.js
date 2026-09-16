/**
 * Argument parsing that the tests exercise directly, kept out of convert.js so
 * requiring it does not run the CLI.
 */

/**
 * Parse a page selection like "1", "2-4" or "1,5-7" into a set of page numbers.
 * Pages are 1-indexed to match how a reader refers to them.
 */
function parsePageSpec(spec) {
  if (!spec) throw new Error('--pages needs a value, for example 1 or 2-4 or 1,5-7');

  const pages = new Set();
  for (const part of spec.split(',')) {
    const range = part.trim().match(/^(\d+)(?:-(\d+))?$/);
    if (!range) throw new Error(`Cannot read "${part.trim()}" as a page or range.`);

    const from = Number(range[1]);
    const to = range[2] === undefined ? from : Number(range[2]);
    if (from < 1) throw new Error('Pages are numbered from 1.');
    if (to < from) throw new Error(`Range "${part.trim()}" ends before it starts.`);
    for (let n = from; n <= to; n++) pages.add(n);
  }
  return pages;
}

module.exports = { parsePageSpec, _internals: { parsePageSpec } };
