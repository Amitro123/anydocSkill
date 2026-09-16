# anydoc-skill

Claude Code skill that converts documents to Markdown and to a standalone HTML page,
with correct right-to-left layout for Hebrew.

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
`--out-dir` is given. `--force` writes output that failed the scrambled-text check.
`--ingest` adds knowledge-base metadata — see below.

`--pages` selects part of a PDF: `--pages 1`, `--pages 2-4`, `--pages 1,5-7`. Pages are
numbered from 1, and it applies to PDFs only — other formats have no page numbers, so
the flag is refused rather than silently ignored.

As a skill, `/anydoc <file>` — it asks which format you want unless your request
already names one.

## Formats

| Input | Handled by | Notes |
|---|---|---|
| `.pdf` | pdf.js | Structure tree when tagged, page geometry otherwise |
| `.pptx` | direct | One section per slide, speaker notes included |
| `.docx` `.doc` | anydoc | Best structural fidelity of any input |
| `.xlsx` `.xls` `.csv` | anydoc | Markdown tables |
| `.odt` `.rtf` `.epub` | anydoc | Headings survive if the source used real styles |
| `.md` `.txt` | read directly | RTL post-processing only |

`.ppt` converts through anydoc but without slide boundaries; prefer `.pptx`.

Arabic uses the same code paths and is detected by the same Unicode ranges, but is
untested and the scrambled-text check does not cover it.

## Hebrew and RTL documents

Hebrew converts correctly, including from PDF. If you hit the scrambled-text error,
this section is what it means.

**Visual order vs. logical order.** A PDF stores positioned glyphs, not sentences. Some
extractors return Hebrew in the order it was painted — right to left — which read back
as a string leaves every word reversed: `רושיג` instead of `גישור`. It is unreadable and
unsearchable, and nothing downstream can repair it, because the damage happens before
any RTL handling runs.

**This is why PDFs do not go through anydoc.** anydoc's PDF extractor returns visual
order for Hebrew, so PDFs are read with pdf.js, which returns logical order. Every
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

**Headers and footers survive a partial extract.** Page furniture is dropped only when it
repeats on every page converted. Convert one page and the strip is kept, because a line
that appears once is content — often the only place a company name or a contact detail
appears. This holds for tagged and untagged PDFs alike.

**Scanned PDFs are a different problem.** A scan has no text layer at all, so extraction
returns nothing and you get an empty document — the command warns when this happens. Add
a text layer first (`ocrmypdf` is the usual tool) and convert the result; it still has to
pass the same check.

**`--force` is not the default on purpose.** Output that is silently wrong is worse than
a conversion that refuses: scrambled Hebrew looks like text, survives review, and only
surfaces once it is already in a knowledge base.

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

Four decisions look like they could be simplified. They cannot:

- **`dir` goes on `<html>`, not `direction: rtl` in CSS.** `dir` is inherited and gives
  the Unicode bidi algorithm a base direction. CSS alone sets visual direction without
  that base, and mixed Hebrew/Latin runs — IDs, phone numbers, currency — come out wrong.
- **PDFs do not go through anydoc.** Its PDF extractor returns Hebrew in visual order,
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

Every extraction is checked for visual-order scrambling before anything is written.

## Releasing a change

Installed copies update on the `version` field in `.claude-plugin/plugin.json`, not on
new commits. Pushing a fix without bumping it leaves every existing install on the old
code — `claude plugin update` will report it is already current. Bump the version in the
same commit as the change.

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
```

The unit suite covers pure helpers; the integration suite generates a document in each
format, runs it through the CLI, and asserts on the output. Fixtures are built at test
time, so no documents are stored in this repo.

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
