# anydoc-skill — CLAUDE.md

## Version management — four places must stay in sync

Every release bump must touch four locations. `npm run test:versions` catches a mismatch;
CI fails if any one is stale. The four places are:

- `package.json` — `"version"`
- `package-lock.json` — root `"version"` **and** the nested `packages[""].version` entry
- `.claude-plugin/plugin.json` — `"version"`

After bumping all four, regenerate the lock file and confirm:

```bash
npm install --package-lock-only
npm run test:versions
```

A running session keeps the version it loaded at startup — fixes reach users on the
**next** session, not the current one.

## Testing

```bash
npm test                    # all suites in order (fastest feedback loop)
npm run test:unit
npm run test:integration
npm run test:ocr-pdf
npm run test:ocr
npm run corpus              # generated corpus (CI-safe)
ANYDOC_CORPUS=~/anydoc-corpus npm run corpus   # your private documents
```

`test:ocr` and `test:ocr-pdf` never need `ocrmypdf` installed — `test/fake-bin/` stands
in for it. Real documents belong outside this repo; point `ANYDOC_CORPUS` at a folder of
your own and its snapshots live beside it, never committed here.

## Developing the skill locally

Use `node src/convert.js` and `node src/ocr.js` directly — not through the installed
plugin. The plugin serves the last published version, not the working tree.

```bash
node src/convert.js contract.pdf --verify
node src/ocr.js scan.pdf --lang heb+eng
```

Test the change locally, then release a new version for the skill path to pick it up.

## Node version requirement

Requires Node ≥ 22.13 (`pdfjs-dist` sets this floor). Check with `node -v` before
running anything — Node 20 LTS will fail to install. This lives in `package.json`'s
`"engines"` field, which `npm ci` enforces; `.claude-plugin/plugin.json` has no such
field and Claude Code does not read one from it, so it is not duplicated there.

## Releasing a change

1. Bump the version in all four places (see "Version management" above)
2. `npm install --package-lock-only`
3. `npm run test:versions` — must pass
4. `npm test` — must pass
5. Commit everything in one commit; push
