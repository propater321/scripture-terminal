# Contributing

Start with the [local setup and data guide](docs/setup.md); coding agents should read [AGENTS.md](AGENTS.md).

Use Linux, Bun 1.4.4 and Python 3.12+; install FriBidi for Hebrew display. Start with `bun install --frozen-lockfile`, `bun run check:release`, and `bun test`. Source-only tests need no downloaded corpus or Codex account. Corpus tests skip clearly when their data is missing; `bun run test:integration --all` requires every library and fails if prerequisites are absent.

Before changing data or reference handling, run the affected imports in a separate checkout and validate source counts, checksums, native references, translation gaps, search results and citation navigation. Keep editions named and separate. Do not fill translation gaps with generated text or silently change canonical numbering. Do not update a provenance checksum solely to make a failing import pass.

To regenerate Python dependencies, use `uv pip compile scripts/requirements-search.txt --python 3.12 --generate-hashes -o scripts/requirements-search.lock`, then audit and test semantic retrieval and refinement. Keep direct dependencies pinned. Do not commit data, models, bookmarks, generated previews, answers, credentials or local paths.

UI changes should be exercised at 140×44 and 60×18, with keyboard, mouse, scrolling and library switching. Native smoke scripts are under `scripts/check-*.ts`; live Codex checks are separate and consume the signed-in user's allowance. CI must not run live Ask checks or receive account credentials.

Contributions to original application code are under the MIT license. Third-party texts and metadata retain their own terms; see NOTICE.md.
