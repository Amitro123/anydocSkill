---
name: anydoc
description: Convert documents (PDF, Word, PowerPoint, Excel, EPUB, CSV, RTF, OpenDocument) to Markdown and/or a styled standalone HTML page, with automatic RTL handling for Hebrew and Arabic. Use whenever the user shares a document file and wants its text extracted, converted, read, or turned into Markdown or HTML.
---

# anydoc — document conversion with RTL support

Wraps [anydoc](https://github.com/firecrawl/anydoc) and adds RTL (Hebrew/Arabic) direction handling plus an HTML renderer.

## Always ask for the output format first

Unless the user already said which format they want, ask with `AskUserQuestion` before converting:

- **Both (recommended)** — `.md` for editing and reuse, `.html` for reading and printing
- **Markdown only** — for a repo, a CMS, or feeding an LLM
- **HTML only** — for reading in a browser or printing to PDF

Map the answer to `--format both | md | html`. If the user named a format in their
request ("convert this to markdown"), skip the question and use it.

## Running it

```bash
node src/convert.js <input-file> --format both [--out-dir <dir>]
```

Outputs land next to the input unless `--out-dir` is given. `--format` defaults to `both`.

Text input (`.md`, `.txt`) skips extraction and goes straight to RTL post-processing,
so an existing file can be rendered to HTML without anydoc installed.

## What RTL handling does

`src/rtl.js` counts letters in the Hebrew (`U+0590–05FF`) and Arabic (`U+0600–06FF`)
Unicode blocks. Above a 30% ratio the document is treated as RTL, which adds:

- YAML front-matter: `dir: rtl` and `lang: he` (or `ar`)
- A `<div dir="rtl" lang="he">` wrapper around the Markdown body

`src/render-html.js` puts `dir` and `lang` on the `<html>` element itself. That matters:
`dir` is an inherited HTML attribute, so the whole document resolves under the correct
base direction and the Unicode bidi algorithm lays out mixed Hebrew/Latin runs (names,
ID numbers, phone numbers, currency) correctly. CSS `direction: rtl` alone does not do
this — it sets visual direction without giving bidi a base direction to resolve against.

The generated HTML is standalone: inline CSS, no network dependencies, a Hebrew-capable
serif stack, dark-mode support, and print rules so it exports cleanly to PDF.

## PDFs use pdf.js, not anydoc

anydoc's PDF extractor emits Hebrew in visual order — every word character-reversed
(`רושיג` for `גישור`) — so PDFs are routed through pdf.js, which returns logical order.

Tagged PDFs (most things exported from Word) are read through their structure tree by
`src/pdf-structure.js`, giving exact paragraph and list boundaries and skipping headers
and footers, which are untagged. `src/pdf-extract.js` handles untagged PDFs by inferring
paragraphs from line geometry.

Document numbering is preserved literally — a Markdown ordered list is only used where
Markdown would render the document's own labels unchanged. Left-to-right runs embedded
in RTL text (case numbers, IDs, phone numbers) are reordered back to logical order.

Every extraction is still checked for visual order whatever produced it, by counting
Hebrew final forms (ך ם ן ף ץ) at the start versus the end of words. On failure
`convert.js` refuses to write; `--force` overrides.

What a PDF cannot give you is structure the author never created: a document formatted
by hand tags every block as a plain paragraph, so headings will not appear. Prefer the
`.docx` or `.pptx` source when one exists.

## PowerPoint keeps slide boundaries

anydoc extracts .pptx text correctly but flattens the whole deck into one run, so a
34-slide presentation arrives with no indication of where slides begin or end.
`src/pptx-extract.js` reads the slide parts directly and emits one section per slide,
with speaker notes quoted beneath their slide. Section labels follow the deck's own
language, so an English deck is not labelled in Hebrew.

Slide numbers, footers and dates are placeholders inherited from the slide master and
are dropped, so they do not surface as stray digits in the slide body or the notes.

## Output naming

Output lands at `<basename>.md` / `<basename>.html`, and the Markdown front-matter
records the source file. Converting `report.pdf` and `report.docx` into the same
directory therefore warns before the second overwrites the first — re-converting the
same source stays silent.

## After converting

Tell the user where the files landed. If HTML was produced, offer to open or preview it —
for a Hebrew document, confirming the direction looks right is worth the extra step.
