---
name: anydoc-ocr
description: Add a text layer, via OCR, to the specific pages of a PDF or slides of a PowerPoint deck that anydoc reported as PICTURE ONLY or refused outright for holding no text — a scan, a slide exported as an image, a signed page. Re-runs anydoc on the result and refuses to write anything if OCR changed a page or slide it was not asked to touch. Use only after anydoc itself has already been tried on the document.
when_to_use: "anydoc's --verify reported PICTURE ONLY page(s) or slide(s), or anydoc refused the whole document with exit code 4 (no text found). Not for a document anydoc has not been run on yet — try anydoc first, always."
allowed-tools: Bash, Read, AskUserQuestion
---

# anydoc-ocr — OCR for the pages or slides anydoc could not read

## This is not anydoc, and it runs after anydoc, never instead of it

anydoc reads the text a document's author actually wrote. This tool guesses text from
an image, for the specific pages or slides anydoc already established have none. Try
anydoc first, always — most documents need nothing this adds, and this tool's own first
step is running anydoc anyway to find out which, if any, actually need it.

Run it when anydoc's report showed one of:

- `PICTURE ONLY — page(s) ... draw an image and hold no text.`
- exit code 4, `No text found in <file> — nothing was written.`

Do not run it for `IMAGE AMONG TEXT`. Those pages already have a real text layer, and
this tool refuses to touch them for the same reason anydoc itself would refuse to
overwrite good text with a guess — see "What this will not do" below.

```bash
node "${CLAUDE_PLUGIN_ROOT}/src/ocr.js" <input.pdf|input.pptx> [--out-dir <dir>] [--lang heb+eng]
```

`${CLAUDE_PLUGIN_ROOT}` resolves to the installed plugin directory. Inside this
repository rather than through an install, use `node src/ocr.js` instead.

## What it actually does

1. Runs anydoc on the document to see which pages or slides, if any, are PICTURE ONLY.
2. If none are, says so and stops — there is nothing here for it to add, and it does
   not touch anything.
3. Otherwise runs `ocrmypdf`, restricted to exactly those pages or, for a .pptx, to
   exactly that slide's own picture, extracted from the deck itself. Every other page
   or slide is passed through untouched — a .pptx is never rewritten at all, only the
   Markdown convert.js renders from it changes.
4. Runs anydoc again on the result, and compares the two reports page by page (or slide
   by slide). A page or slide that already had text must come back with the exact same
   text — checked by content digest, not by trusting the OCR tool's own flags.
5. Only if that comparison is clean does it write `<title>.md`/`.html` and a
   `<title>.ocr-report.json` naming which pages or slides came from OCR.

## What this will not do

**It will not touch a page with `IMAGE AMONG TEXT`.** Those pages have real, already-
correct text next to the image; OCR-ing the page would mean redoing the whole thing and
risking text that already reads correctly, on the chance of recovering words inside an
image that may not even be there. This tool says so and stops rather than guessing.

**It will not silently replace good text with worse text.** If OCR (or anything about
running it — recompression, a page renumbered) changes a page that was not supposed to
change, the whole run is refused: nothing is written, and the original document is
untouched. Report this to the user rather than retrying with `--force` — there is no
such flag here, and that is deliberate.

## Reading the exit code

- **0** — either it finished (report what it found — see below), or there was nothing
  to do. The message on stdout says which.
- **1** — an ordinary failure: bad arguments, missing file, not a PDF or PowerPoint
  deck, or `ocrmypdf` itself failed partway through. Read the message and relay it.
- **5** — `ocrmypdf` or a needed Tesseract language is not installed. The message names
  the exact install command for the user's platform. Offer to run it if the user wants
  to, but do not run a package-manager install yourself without asking first — see
  "Installing the dependency" below.
- **6** — OCR changed a page or slide it should not have. Nothing was written. Tell the
  user plainly what happened; do not try again with different flags, and do not suggest
  `--force` — the tool has none, because there is no safe way to override this check.

## What to tell the user afterwards

**Always say which pages' text came from OCR**, using `<title>.ocr-report.json`'s
`recovered` and `provenance` fields, or the prose summary the tool already printed.
OCR text is a plausible reading, not a certain one — say this every time, not only on
request, and especially if the user or another agent will act on the document's
contents (a figure, a date, a clause) without reading it themselves first.

If some pages are still unreadable after OCR (`stillUnreadable`), say so plainly. That
document's content genuinely is not recoverable this way — a blank scan, a photograph
rather than a document — and no flag here changes that.

## Installing the dependency

If exit code 5 comes back, tell the user what is missing and how to install it (the
message already has the exact command). Ask before running an install command yourself
— `apt-get`, `brew`, or `pip` all change the system beyond this project, and a person
without sudo, or on a machine they do not want touched, needs to say yes first.
