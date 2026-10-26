# Working on Scripture Terminal

Read [docs/setup.md](docs/setup.md) for local installation, data downloads, optional semantic search and verification. [docs/how-it-works.md](docs/how-it-works.md) describes the architecture; [CONTRIBUTING.md](CONTRIBUTING.md) covers development conventions.

## Start here

- Work from the repository root. Check `git status`, `bun --version` and `python3 --version` before making changes. The validated target is Linux x64 with Bun 1.4.4 and Python 3.12+; Hebrew display needs FriBidi.
- For source-only work, use `bun install --frozen-lockfile` and `bun run check:release`. This needs no corpus, model download or Codex account.
- For a usable minimal app, import Bible and its connections with `bun run import` then `bun run import:links`. Verify with `bun run doctor`, `bun run test:integration` and `bun scripts/check-explore.ts`.
- If no library scope is specified, start with Bible. Install additional libraries and semantic models when the task needs them; the full development data/model set occupies roughly 4 GB plus temporary build space.
- The UI needs a TTY of at least 60 × 18 cells. For unattended checks, use the native PTY smoke scripts. Do not leave an interactive `bun start` waiting in a piped shell.

## Keep local data intact

- Preserve `data/study.sqlite` (bookmarks). Stop the app before backing it up or replacing its checkout. Use a separate checkout for import experiments that could affect installed data.
- Keep `data/`, `.venv-search/`, `node_modules/`, generated `previews/`, credentials and local paths out of commits. Only the reviewed UI images under `docs/images/` belong in documentation.
- Texts and models retain their own licenses; see [NOTICE.md](NOTICE.md). Do not bundle the local corpus with the MIT code.
- Importers verify pinned sources. Never bypass a checksum or replace a manifest hash just to make an import pass. Report an upstream mismatch and preserve the existing database.
- Some Jewish importers rewrite provenance timestamps in tracked manifests. Inspect `git diff -- sources/` after imports. Do not automatically stage those changes or overwrite someone else's manifest edits.
- Rebuild the affected semantic index and connections after a corpus change. Preserve native reference numbering and explicit translation gaps.

## Verify the relevant behavior

- Type and source/import checks: `bun run check:release`.
- Bible integration: `bun run test:integration` requires Bible and Bible connections. Full corpus integration: `bun run test:integration --all` requires every text library and Torah connections.
- `bun test` deliberately skips corpus suites when their databases are missing. Report skips; do not treat a source-only pass as validation of the installed app.
- For UI changes, exercise the affected native smoke scripts at their built-in wide and compact sizes. For search or data changes, run the matching evaluations and integrity checks listed in the setup guide.
- Documentation-only changes need link/command review and relevant setup verification, not model requests or a full reindex.

## Codex and publishing

- Ask is optional and uses the user's managed Codex login. Never read, copy or commit login tokens or change global Codex configuration to make tests pass.
- Live `check:research`, `check:codex` and `check-*-research` scripts submit questions and consume the signed-in user's allowance. Run them when live Ask validation is within the user's authorized task; routine setup and CI use local tests instead.
- Before publishing, follow [docs/release-checklist.md](docs/release-checklist.md). Existing user authorization for publishing or updating this repository remains applicable; these instructions do not add a separate approval requirement.
