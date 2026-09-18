/**
 * Compare an anydoc report taken before a PDF was handed to OCR against one taken
 * after, and decide what is allowed to have changed.
 *
 * OCR here has exactly one job: add a text layer to pages that had none. Everything
 * else about every other page — its words, their order, whether a line repeats — was
 * already read correctly, and a second tool touching any of that is not an improvement,
 * it is the exact failure this project exists to catch, arriving from a new direction.
 * `--report`'s per-page digest is what makes that checkable: a page's digest is a
 * fingerprint of its normalised text, so an unchanged page keeps its digest exactly,
 * and this is the one thing standing between "OCR filled in a gap" and "OCR quietly
 * replaced good text with a worse guess".
 *
 * This module only compares two reports already in hand. It runs nothing and reads no
 * files — a pure function is what lets the interesting cases live in a unit test rather
 * than a fixture that needs ocrmypdf installed to exercise.
 */

/**
 * @param {object} before - reportJson() from src/verify.js, taken before OCR ran
 * @param {object} after - reportJson() from src/verify.js, taken after OCR ran
 * @returns {{
 *   ok: boolean,
 *   pageCount: {before: number, after: number, match: boolean},
 *   unexpectedChanges: {page: number, reason: string}[],
 *   recovered: number[],
 *   stillUnreadable: number[],
 *   provenance: Record<number, 'original'|'ocr'|'unreadable'>,
 * }}
 */
function reconcile(before, after) {
  const beforeByPage = new Map(before.pages.map(p => [p.page, p]));
  const afterByPage = new Map(after.pages.map(p => [p.page, p]));
  const pictureBefore = new Set(before.pictureOnly);

  const unexpectedChanges = [];
  const recovered = [];
  const stillUnreadable = [];
  const provenance = {};

  for (const [page, beforePage] of beforeByPage) {
    const afterPage = afterByPage.get(page);
    if (!afterPage) {
      unexpectedChanges.push({ page, reason: 'the page is missing from the OCR\'d document' });
      continue;
    }

    if (pictureBefore.has(page)) {
      // This is the one page kind OCR was asked to touch, so a changed digest here is
      // the point rather than a problem — there was no text before, so nothing to compare
      // it against. Whether it produced anything is a different question, answered by
      // whether the page still reads as a picture.
      if (afterPage.picture) {
        stillUnreadable.push(page);
        provenance[page] = 'unreadable';
      } else {
        recovered.push(page);
        provenance[page] = 'ocr';
      }
      continue;
    }

    // Every other page had a text layer already, so its digest is a promise: this is
    // what the page said before anything else touched it, and it is what the page must
    // still say. `--skip-text` and the explicit `--pages` restriction in src/ocr.js are
    // both meant to guarantee that on their own; this is what actually checks it.
    provenance[page] = 'original';
    if (beforePage.digest !== afterPage.digest) {
      unexpectedChanges.push({
        page,
        reason: `text changed on a page that already had a text layer ` +
          `(was ${beforePage.digest}, now ${afterPage.digest})`,
      });
    }
  }

  // A page appearing that was not there before should be impossible — OCR does not add
  // pages — but naming it here beats a page count mismatch nobody can trace to a cause.
  for (const page of afterByPage.keys()) {
    if (!beforeByPage.has(page)) {
      unexpectedChanges.push({ page, reason: 'the page was not in the original document' });
    }
  }

  const pageCount = {
    before: before.totals.pages,
    after: after.totals.pages,
    match: before.totals.pages === after.totals.pages,
  };

  return {
    ok: pageCount.match && unexpectedChanges.length === 0,
    pageCount,
    unexpectedChanges,
    recovered,
    stillUnreadable,
    provenance,
  };
}

const SHOWN = 8;

/**
 * A person-readable account of what reconcile() decided, in the same voice as
 * src/verify.js's report().
 */
function reconcileReport(result) {
  const lines = [];

  if (!result.pageCount.match) {
    lines.push(`  PAGE COUNT — ${result.pageCount.before} page(s) before OCR, ` +
      `${result.pageCount.after} after. Refusing the result.`);
  }

  if (result.unexpectedChanges.length) {
    lines.push(`  REFUSED — OCR changed ${result.unexpectedChanges.length} page(s) it was ` +
      `not asked to touch:`);
    lines.push(...result.unexpectedChanges.slice(0, SHOWN).map(
      c => `    p${c.page}: ${c.reason}`));
    if (result.unexpectedChanges.length > SHOWN) {
      lines.push(`    ... and ${result.unexpectedChanges.length - SHOWN} more`);
    }
    lines.push('  The OCR\'d file is not being used. Nothing was overwritten.');
    return lines.join('\n');
  }

  if (result.recovered.length) {
    lines.push(`  OCR added a text layer to ${result.recovered.length} page(s): ` +
      `${result.recovered.join(', ')}.`);
    lines.push('    That text is a guess, not a reading of the document — check it before');
    lines.push('    relying on it, and treat it as less certain than the rest of the page.');
  }

  if (result.stillUnreadable.length) {
    lines.push(`  STILL UNREADABLE — OCR found nothing on page(s) ` +
      `${result.stillUnreadable.join(', ')} either.`);
  }

  lines.push(`  Every other page's text is byte-for-byte what it was before OCR ran.`);
  return lines.join('\n');
}

module.exports = { reconcile, reconcileReport };
