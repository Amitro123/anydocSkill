# anydoc-skill

### This is what lets your agent read Hebrew documents.

Hand an agent a Hebrew PDF and it will usually hand you back nonsense. Most extractors
return Hebrew in the order the glyphs were painted rather than the order they are read,
which reverses every word — `רושיג` where the page says `גישור`. It still looks like
Hebrew. It is unsearchable, unquotable, and wrong in a way nobody notices until the
answer built on it is already wrong too.

This is a Claude Code skill that converts documents — PDF, Word, PowerPoint, Excel and
more — to Markdown and to a standalone HTML page, with the text in reading order, the
direction right, and the structure a Hebrew document actually has:

```bash
node src/convert.js contract.pdf --verify
```

```
Verified contract.pdf: 214 lines of page text.
  No text lost, no number changed.
```

That last line is the point. An agent cannot tell a good extraction from a bad one by
looking at it, and neither can you — so the conversion checks itself against the page it
came from and says what it found. Where the text cannot be trusted it **refuses** rather
than handing over something plausible.

Written for Hebrew because Hebrew is where extraction breaks; everything here works the
same on a document in any language.

---

Getting the words out of a document is the easy half. The half that goes wrong quietly
is everything around them — a footer that vanishes, a table flattened into a sentence, a
legal clause renumbered by one. Each section below exists because a real document was
converted wrongly and nobody noticed until they read it:

| | |
|---|---|
| [Hebrew and RTL](#hebrew-and-rtl-documents) | Logical vs. visual order, and why the `.md` carries an invisible mark on every line |
| [Headings](#headings-a-document-never-declared) | Recovering section titles a hand-formatted document never declared |
| [Numbering](#numbering) | Keeping clause numbers a renderer would otherwise count for itself |
| [Tables](#tables) | Recovering columns, and refusing to guess when they are ambiguous |
| [Page furniture](#page-furniture) | Dropping a repeated header without deleting a repeated template |
| [`--verify`](#checking-a-conversion) | Reading the page back against the output, mechanically |
| [Regression corpus](#regression-corpus) | Real documents, kept outside this repo, pinned to snapshots |

The one rule underneath all of it: **losing text silently is worse than converting
badly.** Where the shape of a document cannot be recovered with confidence, the text
comes through flat and intact rather than arranged into a guess.

## Install as a Claude Code plugin

```bash
claude plugin marketplace add Amitro123/anydocSkill
claude plugin install anydoc@anydoc-skill
```

Node dependencies install automatically (`npm ci --ignore-scripts`) because this repo
ships a `package-lock.json`.

> **Requires Node 22.13 or later** — check with `node -v`. The floor comes from
> `pdfjs-dist`, which declares `>=22.13.0 || >=24`. Node 20 LTS will not install it.

## Or work on it directly

```bash
npm install
```

## Use

```bash
node src/convert.js contract.pdf                      # writes contract.md + contract.html
node src/convert.js deck.pptx --format md
node src/convert.js report.docx --format html --out-dir ./out
```

`--format` is `md`, `html`, or `both` (default). Output lands next to the input unless
`--out-dir` is given.

| Flag | |
|---|---|
| `--verify` | Check the conversion against the document it came from — the full check on PDFs, renderer-only on other formats ([see below](#checking-a-conversion)) |
| `--pages` | Convert part of a PDF |
| `--ingest` | Add knowledge-base metadata — [see below](#knowledge-base-ingest) |
| `--force` | Write output that failed the scrambled-text check |

`--pages` selects part of a PDF: `--pages 1`, `--pages 2-4`, `--pages 1,5-7`. Pages are
numbered from 1, and it applies to PDFs only — other formats have no page numbers, so
the flag is refused rather than silently ignored.

A selection is kept as intervals, never expanded into the pages themselves: `2-4` is
cheap to expand and `1-10000000` is not, and the spec does not say which is coming.
Anything past page 100,000 is refused outright, before the PDF is opened — no document
is that long, so it is a typo or a hostile argument either way. Whether the pages exist
is checked once the document is open, naming the parts that do not.

As a skill, `/anydoc <file>` — it asks which format you want unless your request
already names one.

## Formats

| Input | Handled by | Notes |
|---|---|---|
| `.pdf` | pdf.js | Structure tree when tagged, page geometry otherwise |
| `.pptx` | direct | One section per slide, speaker notes included |
| `.docx` `.doc` | firecrawl/anydoc | Best structural fidelity of any input |
| `.xlsx` `.xls` `.csv` | firecrawl/anydoc | Markdown tables |
| `.odt` `.rtf` `.epub` | firecrawl/anydoc | Headings survive if the source used real styles |
| `.md` `.txt` | read directly | RTL post-processing only |

`.ppt` converts through the extractor but without slide boundaries; prefer `.pptx`.

> **Two things are called anydoc.** This skill, and [`@firecrawl/anydoc`][anydoc], the
> library it uses for the office formats — referred to below and in the comments as *the
> firecrawl/anydoc extractor*. **PDFs deliberately do not go through it**: its PDF
> extractor returns Hebrew in visual order, which scrambles it beyond repair. That one
> decision is why this tool exists rather than being a thin wrapper around that one.

[anydoc]: https://www.npmjs.com/package/@firecrawl/anydoc

Arabic uses the same code paths and is detected by the same Unicode ranges, but the
scrambled-text check **cannot detect scrambled Arabic** — the signal reads Hebrew final
forms, which no other script has. The conversion says so rather than reporting clean.

## Hebrew and RTL documents

Hebrew converts correctly, including from PDF. If you hit the scrambled-text error,
this section is what it means.

**Visual order vs. logical order.** A PDF stores positioned glyphs, not sentences. Some
extractors return Hebrew in the order it was painted — right to left — which read back
as a string leaves every word reversed: `רושיג` instead of `גישור`. It is unreadable and
unsearchable, and nothing downstream can repair it, because the damage happens before
any RTL handling runs.

**This is why PDFs do not go through firecrawl/anydoc.** Its PDF extractor returns
visual order for Hebrew, so PDFs are read with pdf.js, which returns logical order. Every
extraction is then checked regardless of which path produced it, by counting Hebrew
final forms (ך ם ן ף ץ) — they only ever end a word in correct Hebrew, and only ever
start one in reversed text.

**If the check fires**, the conversion exits with code 2 and writes nothing. It is not a
bug in the document or in this tool; the extractor handed back scrambled text. Do one of:

- Convert the original `.docx` or `.pptx` instead. They carry real structure and extract
  correctly — always prefer them over a PDF of the same document.
- Re-run with `--force` if you want the output anyway, knowing the text is scrambled.

**Markdown carries no direction of its own.** The `.md` gets `dir: rtl` front-matter and
a `<div dir="rtl">` wrapper, but those only reach a renderer that keeps raw HTML and does
not sanitise the attribute away. Everywhere else — a plain editor, most previews — the
base direction would fall back to LTR, which left-aligns the text and strands digits and
Latin runs on the wrong side of the line. So each line also gets a U+200F mark, placed
after any `#`, `-` or `1.` so the Markdown still parses. It is invisible and makes the
line resolve RTL with no HTML at all. The `.html` output does not need it — direction
lives on the `<html>` element there.

**Scanned PDFs are a different problem.** A scan has no text layer at all, so extraction
returns nothing. The conversion refuses with exit code 4 and writes nothing: an empty
document reported as a success is the silent loss this tool exists to avoid, and a batch
caller scripted against the exit codes would file a 200-page scan as converted. Add a
text layer first (`ocrmypdf` is the usual tool) and convert the result; it still has to
pass the same check. `--force` writes the empty document anyway.

**`--force` is not the default on purpose.** Output that is silently wrong is worse than
a conversion that refuses: scrambled Hebrew looks like text, survives review, and only
surfaces once it is already in a knowledge base.

## Page furniture

A running header or footer belongs to the page, not the document, so repeating it under
every page break is noise. Identifying it is guesswork, though, and both ways of getting
it wrong lose real content.

It is dropped only when it repeats on **every page converted**. Convert one page and the
strip is kept, because a line that appears once is content — often the only place a
company name or a contact detail appears on that page.

Repetition also stops counting once it covers more than half the document. Pages that are
copies of one template — two tickets from the same order, the same form filled twice —
repeat nearly everything, and almost none of it is a header. Without that guard a
two-page ticket order came out as four lines.

Both extraction paths share the test, so a PDF converts the same whether or not it
carries a structure tree. `--verify` lists what was dropped this way, apart from the
losses, so you can see it was furniture.

## Headings a document never declared

Most documents are formatted by hand: the section titles are bold body text, not real
heading styles. No extractor can recover what the author never wrote, so the output
would be one flat run of paragraphs with nothing to navigate by.

A bold paragraph is therefore raised to `##` when it also looks like a title — under 80
characters, not ending in `.`, `!` or `?`, and with body text underneath it. A bold
sentence stays emphasis, and a bold sign-off at the end stays a sign-off. Documents that
already contain real headings are left alone entirely: their author did use styles, so
bold there is only ever emphasis.

Marking the titles as Heading 1/2/3 in Word still beats the heuristic — do that where
you can and this never has to guess.

The reverse case is handled too. Extracted page text is read back as Markdown, so a line
that happens to open with `#` — an invoice's first table column, say — would be re-read
as a heading. Those are escaped. A dash is not: a dash-prefixed line usually is the list
it looks like, and escaping them flattened a syllabus into paragraphs. A line that opens
*and* closes with one (`- עמוד 1 -`) is decoration, and is escaped.

## Numbering

A renderer honours the number a list opens with and counts everything after it from
there. So `1.` `1.` `2.` `3.` — a letter numbering its sections and its clauses
separately — renders as 1, 2, 3, 4, and every clause number in the document shifts. The
same happens wherever numbering restarts under a heading or skips a reserved number.

Renumbering a legal document changes what it says: its clauses are cross-referenced by
number, inside the document and outside it. A run therefore stays a real list only when
the renderer would arrive at the same numbers. Otherwise its numbering is escaped and
reads exactly as the page does.

A clause running past the foot of a page is put back together too. Pages are read one at
a time, so the tail arrives tagged as a list item whose label stayed behind — which
rendered as a bullet dropped into the middle of a sentence.

A contract usually tags its clauses as a list but writes the numbering into the text
rather than into a label, so every item arrives unlabelled already carrying `4.` or
`4.1.` at the front. Adding a bullet there prints a mark the page does not have, in
front of the number it does, so each clause becomes a block of its own and the numbering
reads as the document wrote it. A list that really is unlabelled bullets still gets
them — the numbering is what makes the marker redundant.

## Tables

A PDF stores a table as ruled lines and positioned glyphs. Nothing in the file says
which value belongs under which heading — that has to be recovered from where the cells
sit, and recovering it wrongly files a number under the wrong column. On an invoice that
is worse than the flat text it replaces, so a run of lines becomes a table only when the
columns are unambiguous: every row divides into the same number of cells, and the
columns stand further apart than their own cells are ragged. Anything less stays
paragraphs.

A tagged PDF states its columns instead of implying them, and that reading is taken
as-is — except for a grid holding no text, which is how a hand-formatted page positions
images rather than a table worth rendering.

Markdown has no row or column spans, so a table needing either is left as paragraphs.

## Checking a conversion

`--verify` reads the page text straight back out of the PDF and compares it with the
finished HTML turned into the words a reader would see:

```bash
node src/convert.js letter.pdf --verify
```

```
Verified letter.pdf: 277 lines of page text.
  2 repeated header/footer line(s) dropped, as intended:
    עתיד האוטומציה: הדרכות | ייעוץ
  No text lost, no number changed.
```

It reports five things: lines the page shows and the output does not, lines that kept
every word but changed order (a table row read across rather than down), header and
footer lines dropped on purpose, numbers whose tallies differ — which is how a renumbered
list shows up, since a renderer generates those numbers rather than storing them — and
glyphs the page draws that carry no character at all. Exit code is 3 for any of those
that mean text the reader can see is not in the output.

Every defect this converter has had was visible this way. Finding them meant reading a
converted document against its original by eye, which does not scale and misses the
quiet ones — a dropped footer, a clause renumbered by one.

What it does not check: how words were assembled from the glyphs, since it reads lines
through the same joining the converter does. It checks that the lines the extractor read
reach the reader intact.

**Loss before extraction is a separate question, and it is asked separately.** Both
sides of the comparison above come from the same text layer, so a character the PDF
never yielded is missing from both and the comparison calls it clean. The page itself is
the only witness, so the glyphs it draws are counted against the characters they carry:

```
  UNDECODED — 12 glyph(s) the page draws carry no character:
    they are absent from the extraction and from the output alike, so nothing
    else here can see them. The page shows text this conversion does not hold.
```

That counts glyphs, not suspicious-looking text. A bank printing `.10` for ten agorot
reads exactly like a truncated number, and a check that read the output for odd shapes
would call it a defect — this one does not, because the glyphs are all there and all
mapped. Across both corpora, some 55,000 glyphs of Hebrew banking, legal and office
output, the count is zero.

What none of this can catch is a glyph mapped to the **wrong** character. A font whose
tables say `א` where the page shows `ב` produces text that is complete, confident and
wrong, and every check here will pass it. Comparing against a rendering of the page is
the only thing that would see it, and that is not done.

**On anything but a PDF the check is narrower.** Only a PDF can be read back
independently, so only a PDF is checked against the document itself. For every other
format there is no second source to read: the extractor's own output stands in for the
document, and `--verify` compares that against the finished page. It still catches what
the renderer does to the text — markup consumed, a list renumbered, a marker read back
as a word — but it cannot catch a line the extractor dropped, because a line missing
from the extraction is missing from both sides. A clean `--verify` on a `.docx` says the
rendering is faithful to the extraction, not that the extraction was complete. The
report says which of the two it did:

```
Verified deck.pptx: 5 extracted lines reached the output (no page to read back — extraction itself is unchecked).
  No text lost, no number changed.
```

This is why a `.docx` is still worth converting from over a PDF of the same document —
it extracts more reliably in the first place — and why the PDF path is the one with a
real check behind it.

## Regression corpus

The generated fixtures in `test/` pin the behaviours someone thought to write down. Real
documents are what actually find defects — every one so far came from a PDF nobody had
tried, and fixing one silently broke another twice.

Keep those documents **outside the repository**: they are invoices, letters and filings
carrying names, ID numbers and medical details that have no business in a public repo or
in anyone's git history. Point `ANYDOC_CORPUS` at a folder of them and the snapshots are
kept beside them.

```bash
npm run corpus                                        # the generated corpus
ANYDOC_CORPUS=~/anydoc-corpus npm run corpus          # your own documents
ANYDOC_CORPUS=~/anydoc-corpus npm run corpus -- -u    # record the current output
```

With no folder given, the same runner converts a **generated** corpus — the page shapes
that broke real conversions, rebuilt with no real data — against snapshots committed
under `test/snapshots/`. That is the version CI runs, because a contributor cannot see
your private corpus and a layer nobody can run is no signal at all.

Each snapshot holds the Markdown and the verification report. A snapshot is not a claim
that the output is right — it records what it was. Read the diff when one changes: that
is the review, and the point of the suite.

## Knowledge-base ingest

`--ingest` adds provenance metadata and a source notice, for pipelines that store
extracted documents in a wiki or index:

```yaml
---
title: "contract"
source: contract.pdf
source_type: pdf
source_location: ./docs/contract.pdf
extracted_at: 2026-09-16
content_mode: verbatim
dir: rtl
lang: he
---

> **Source:** contract.pdf, extracted by anydocSkill on 2026-09-16.
```

`content_mode` is always `verbatim` — this tool extracts and never summarises. The field
is written so an index holding both extracts and generated summaries can tell them apart
without inspecting the text.

## Calling it from another language

Exit codes are part of the interface, so a caller does not have to parse stderr:

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | Failure — missing file, unsupported format, bad arguments |
| 2 | Extraction returned scrambled text and was refused |
| 3 | `--verify` found text missing from the output, or a number changed |
| 4 | The document holds no text to convert (an un-OCR'd scan) |

An unknown option or a missing flag value is exit 1. A typo is never ignored: silently
dropping a mistyped `--verify` would turn a checked conversion into an unchecked one
that looks the same.

From Python:

```python
import subprocess

result = subprocess.run(
    ["node", "src/convert.js", path, "--format", "md"],
    capture_output=True, text=True,
)

if result.returncode == 2:
    raise RuntimeError(f"Hebrew came back scrambled: {result.stderr}")
if result.returncode != 0:
    raise RuntimeError(result.stderr)
```

Check `returncode`. A caller that only reads stdout sees an empty result and no error.

## Things not to undo

These decisions look like they could be simplified. They cannot — most were paid for by
a document that came out wrong, and several were nearly reverted by the next fix:

- **`dir` goes on `<html>`, not `direction: rtl` in CSS.** `dir` is inherited and gives
  the Unicode bidi algorithm a base direction. CSS alone sets visual direction without
  that base, and mixed Hebrew/Latin runs — IDs, phone numbers, currency — come out wrong.
- **PDFs do not go through firecrawl/anydoc.** Its PDF extractor returns Hebrew in visual order,
  every word character-reversed, which nothing downstream can repair.
- **List numbering is copied, never regenerated.** Markdown renumbers ordered lists, so
  one is only emitted where the document's own labels match what Markdown would render.
  Legal clause numbering must survive exactly.
- **Pages and lines are both assembled by position, never by the order items arrive
  in.** A producer may emit a page's middle before its header, or an RTL line
  left-to-right. Neither array order is document order.
- **A page with columns is read a column at a time.** Sorting a whole page by y
  interleaves a sidebar into the body. Columns are only split at a vertical gutter no
  line crosses, with at least two lines either side, so an indent or a margin note is
  not mistaken for one — and the right-hand column comes first in Hebrew.
- **RTL lines are ordered by position, never by the order items arrive in.** Producers
  disagree: Word emits an RTL line right-to-left, other tools emit it left-to-right.
  Trusting array order reverses every word of a line from the second kind.
- **Left-to-right runs inside RTL text are then reordered by ascending x.** A hyphenated
  case number split across items arrives backwards otherwise.
- **A leading `#` is escaped; a leading dash is not.** Page text never means `#` as
  Markdown, so an invoice column headed `#` would open a heading holding the whole
  flattened row. A dash is the opposite: a dash-prefixed line usually is the list it
  looks like, and escaping those turned a 21-item syllabus into paragraphs. Only a dash
  that also *closes* the line is escaped — decoration, since no list item ends with its
  own marker.
- **Repetition means furniture only while it stays a small part of the document.** A
  header repeats on every page and so does every line of a template — two tickets from
  one order, the same form filled twice. Dropping whatever repeats deleted both tickets.
  Above half the document, what repeats is the document.
- **Untagged page text is kept unless it repeats on every page converted.** The structure
  tree does not reach headers and footers, and discarding them outright lost the only
  place a company name appeared on a one-page extract. Both extraction paths share the
  same test, so a PDF converts the same whether or not it is tagged.
- **A table is only emitted when its columns are unambiguous.** Every row has to divide
  into the same number of cells, and the columns have to stand further apart than their
  own cells are ragged. Filing a number under the wrong heading is worse than the flat
  text it replaces.
- **Bold becomes a heading only with the rest of the shape.** Short, not a sentence, and
  with body text underneath it. A letter emphasises whole paragraphs and signs off in
  bold, and promoting those invents an outline the document does not have.

Every extraction is checked for visual-order scrambling before anything is written, and
`--verify` re-reads the page against the finished output.

## Releasing a change

Installed copies update on the `version` field in `.claude-plugin/plugin.json`, not on
new commits. Pushing a fix without bumping it leaves every existing install on the old
code — `claude plugin update` will report it is already current. Bump the version in the
same commit as the change.

Four places state that version: `package.json`, both roots of `package-lock.json`, and
the plugin manifest. `npm run test:versions` fails when they disagree, because none of
them fails a build on its own — a stale lockfile still installs, and a stale manifest
still reports itself current. After bumping, run:

```bash
npm install --package-lock-only
```

**A running session keeps the version it started with.** `claude plugin update` writes
the new version to disk and says so, but the session that is open resolves
`${CLAUDE_PLUGIN_ROOT}` to the path it loaded at startup — observed still serving 0.2.0
while `installed_plugins.json` recorded 0.4.0. Uninstalling and reinstalling mid-session
does not move it either. A fix reaches you on the next session, not this one.

This matters when developing the skill: converting through it runs the last published
version, not the working tree. Test a change with `node src/convert.js` from the repo,
and go back through the skill once the change is released.

## Tests

```bash
npm test                    # both suites
npm run test:unit
npm run test:integration
ANYDOC_CORPUS=~/anydoc-corpus npm run corpus
```

The unit suite covers pure helpers; the integration suite generates a document in each
format, runs it through the CLI, and asserts on the output. Fixtures are built at test
time, so no documents are stored in this repo.

Three of those fixtures are page shapes that broke a real conversion, rebuilt as the
smallest page that still poses the problem: a table whose first column is headed `#`,
two pages that are copies of one template, and a letter numbering its sections and its
clauses separately.

The [corpus](#regression-corpus) is the suite that catches the next one. Generated
fixtures pin what someone thought to write down; real documents are what actually find
defects, and fixing one silently broke another twice.

> When writing a fixture, keep its text inside the page. Anything past the right edge of
> the MediaBox is clipped before it reaches the extractor, so lines come back truncated
> and the fixture looks like a converter bug.

Two of those assertions are invariants rather than examples, because every ordering
defect found so far was the same mistake in a different place — code treating the order
a producer emitted text in as the order to read it in. Pinning each known case would
only cover the ones already fixed:

- **Emission order must not reach the output.** The same page is converted several
  ways — top to bottom, bottom to top, scrambled — and all must produce identical
  Markdown, which then has to be in the document's own order.
- **`--pages` must select the pages asked for.** Each page of the fixture names its own
  number, so an off-by-one cannot pass; comparing byte counts would let one through.

Both were confirmed by reintroducing the defects they describe and watching them fail.

CI runs both on Node 22.13 and 24.

## License

MIT — see [LICENSE](LICENSE).
