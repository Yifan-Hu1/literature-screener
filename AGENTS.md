# Literature Screener: notes for Codex

Desktop app (Electron + TypeScript + React + SQLite via built-in `node:sqlite`) for
screening biomedical literature from PubMed. The owner is a biomedical researcher with
limited programming experience: explain changes in plain language and give exact
commands when they need to act.

## Commands
- `npm run dev`: run the app. `npm test`: unit tests. `npm run test:e2e`: drives the built
  app with Playwright and saves screenshots to `test-results/e2e/` (inspect them after UI changes).
- `npm run typecheck`, `npm run test:live` (real PubMed), `npm run package:mac|win`.
- Shells launched from VS Code may have `ELECTRON_RUN_AS_NODE=1`; unset it before running
  Electron directly (the dev config and e2e script already do this).

## Scientific-reliability rules (do not weaken)
- Never fabricate or "fill in" metadata. Records store what the source returned, plus `raw_xml`.
- Human decisions are append-only (DB triggers enforce this); the current decision is the
  latest row. Never update or delete decisions.
- AI output (future) goes in its own tables, never in `decisions`, and records model,
  prompt version and criteria version. The UI must show it as clearly labelled AI content.
- Nothing is excluded automatically. Missing abstracts are flagged, not excluded.
- Log every search exactly (query sent, PubMed's translation, counts, date). Never silently
  truncate: searches above 10,000 results are refused; missing records are reported.
- Organism/system tags always carry their source (`pubmed_mesh`, `keyword_match`, `ai`, `manual`).

## Architecture
- `src/shared/api.ts` is the UI ↔ main contract. Adding a method: add it to `InvokeApi`,
  `INVOKE_METHODS`, and the handlers in `src/main/ipc.ts`.
- Schema changes: append a new entry to `MIGRATIONS` in `src/main/project/schema.ts`;
  never edit released migrations.
- Secrets live in per-computer settings encrypted with `safeStorage`, never in projects or git.
- Renderer is sandboxed (contextIsolation, no Node). All network access happens in main.
- Single reviewer for now; decisions already store `reviewer_id` for future dual screening.
  "Current decision" = latest by any reviewer (revisit when adding multi-reviewer mode).

## Roadmap
M1 (done): projects, PubMed search/browse/import, manual screening, persistence.
M2: notes, exclusion reasons (table exists), criteria editing, collections, export (CSV/RIS).
M3: optional AI pre-screening with a provider layer (Codex first) separate from tasks.
M4: full text & supplements (PMC, Europe PMC, Unpaywall, manual import).
Do not start a milestone until the owner has reviewed the previous one.
