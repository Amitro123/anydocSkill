---
name: anydoc
description: Convert documents (PDF, Word, PowerPoint, Excel, EPUB, CSV, RTF, OpenDocument) to Markdown and/or a styled standalone HTML page, with correct right-to-left layout for Hebrew. Use whenever the user shares a document file and wants its text extracted, converted, read, or turned into Markdown or HTML.
when_to_use: "User shares a .pdf, .docx, .pptx, .xlsx, .xls, .csv, .epub, .rtf, .odt, .doc file and wants it converted, extracted, or read. Also when ingesting documents into a knowledge base or wiki (offer --ingest). Do not use for plain text questions about documents the user has already read."
allowed-tools: Bash, Read, AskUserQuestion
---

# anydoc — document conversion with RTL support

## Ask for the output format first

Unless the user already named a format, ask with `AskUserQuestion`:

- **Both (recommended)** — `.md` for editing and reuse, `.html` for reading and printing
- **Markdown only** — for a repo, a CMS, or feeding an LLM
- **HTML only** — for reading in a browser or printing to PDF

Then run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/src/convert.js" <input-file> --format both|md|html [--out-dir <dir>]
```

Output lands next to the input unless `--out-dir` is given.

`${CLAUDE_PLUGIN_ROOT}` resolves to the installed plugin directory. When working inside
this repository rather than through an install, use `node src/convert.js` instead — the
converter is the same, only the path differs.

## When the user is ingesting into a knowledge base

If they mention a wiki, an index, a knowledge base, or storing the output somewhere
rather than reading it, offer `--ingest`. It adds `source_type`, `source_location`,
`extracted_at` and `content_mode` to the front-matter and prepends a source notice, so
the stored document carries its own provenance.

Do not add it by default — it is noise for someone who just wants to read the document.

## What to tell the user afterwards

Say where the files landed. If HTML was produced from a Hebrew document, offer to open
it — confirming the direction reads correctly is worth the extra step.

## When conversion is refused

Every extraction is checked for text returned in visual rather than logical order, which
leaves Hebrew word-reversed and unreadable. On failure the command exits without writing.

Convert from the original `.docx` or `.pptx` if one exists — they extract correctly.
Use `--force` only when the user wants the output despite the text being scrambled.

## Choosing a source file

If the user has the same document in more than one format, prefer `.docx` or `.pptx`
over `.pdf`. PDF carries no structure of its own beyond what the author created, so a
document formatted by hand converts to flat paragraphs with no headings, whatever the
converter does. Say this rather than re-running and hoping for a better result.
