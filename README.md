# Literature Screener

A desktop app (macOS and Windows) for searching PubMed and screening biomedical
literature in local, portable project folders.

**Status:** Milestone 2. Projects, PubMed search (concept builder with MeSH suggestions,
organism/system and study-approach filters, primary-research filter), import or hand-pick,
title/abstract screening with exclusion reasons, comments and notes, organism-label
corrections, collections, CSV / RIS / PRISMA-summary export, and automatic search updates
(new papers and new retraction notices are checked whenever the app is open).
AI screening and full-text retrieval are not built yet.

## Running the app (development)

You need [Node.js](https://nodejs.org) 22 or newer. Open this folder in VS Code,
then open a terminal there (**Terminal → New Terminal**) and run:

```bash
npm install      # first time only, or after dependencies change
npm run dev      # starts the app; close the window or press Ctrl+C to stop
```

## Checking that everything works

```bash
npm test             # fast automated tests (no internet needed)
npm run test:live    # checks the connection to the real PubMed
npm run test:e2e     # opens the app and clicks through the main workflow;
                     # screenshots are saved to test-results/e2e/
npm run typecheck    # checks the code for type errors
```

## Building an app you can double-click

```bash
npm run package:mac  # -> release/mac/Literature Screener.app
npm run package:win  # -> release/win-unpacked/Literature Screener.exe
```

These builds are unsigned, so macOS and Windows show a security warning the first
time you open them. Signed installers come in a later milestone.

## Project folders

```
My Project/
  project.db    all records, searches and screening decisions (SQLite)
  files/        full texts and supplements (later milestones)
  exports/      exported results (later milestones)
  README.txt
```

Keep projects in an ordinary local folder, not one that Dropbox, OneDrive, iCloud or
Google Drive syncs while the app is open. Use **Overview → Back up project…** to make
a consistent copy, for example to move a project to another computer.

API keys and your reviewer name are stored per computer, never in project folders.

## Code layout

```
src/main/            Electron main process (Node): database, PubMed, settings
  project/           project folder + SQLite schema and queries
  sources/pubmed/    PubMed E-utilities client and XML parser
  search.ts          search / browse / import workflows
  tagging.ts         organism & experimental-system tagging
  export.ts          CSV, RIS and PRISMA-summary exports
  updates.ts         scheduled search updates and retraction re-checks
  ipc.ts             connects UI calls to the services above
src/preload/         the narrow bridge between UI and main process
src/renderer/        the user interface (React)
src/shared/          types, search-query builder, organism presets
build/icon.svg       the app icon (build/icon.png is rendered from it)
tests/               automated tests (tests/e2e: end-to-end)
```
