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

Markdown input (`.md`) skips the anydoc step and goes straight to RTL post-processing,
so an existing Markdown file can be rendered to HTML without anydoc installed.

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
(`רושיג` for `גישור`). The text is scrambled before any RTL handling runs, so nothing
downstream can fix it. PDFs are therefore routed through `src/pdf-extract.js`, built on
pdf.js, which returns logical reading order.

Every extraction is still checked for visual order regardless of source. The check
counts Hebrew final forms (ך ם ן ף ץ), which occur only at the end of a word in correct
Hebrew and only at the start in reversed text — a clean signal, not a guess. On failure
`convert.js` refuses to write; `--force` overrides.

Arabic is likely affected by the same anydoc bug but has not been verified.

## After converting

Tell the user where the files landed. If HTML was produced, offer to open or preview it —
for a Hebrew document, confirming the direction looks right is worth the extra step.
