# Release procedure

1. Run `bun install --frozen-lockfile`, `bun run check:release`, `bun audit`, and `pip-audit -r scripts/requirements-search.lock --no-deps --disable-pip` in a disposable audit environment.
2. Run `bun run test:integration --all`, native terminal checks at large and small sizes, source/count audits, and real search evaluations. Run one live Ask check with the maintainer's own login; never put login credentials in CI.
3. Extract `bun run bundle:source` output into a fresh directory. Install with the frozen lockfile, run source tests, import Bible and one optional library from upstream, and open the native terminal. Verify that damaged cached input fails before replacing any database.
4. Inspect `git status`, the source file list, and the archive contents. No corpora, models, bookmarks, generated answers, unreviewed screenshots, private logs, credentials, or personal machine paths belong in the source release. Review new dependency and data licenses. Only the curated public UI images under `docs/images/` belong in the source release; inspect each image and its attribution before publishing.
5. Review CHANGELOG.md and known limitations. Ensure version metadata matches the intended tag. Attach only the generated source archive and checksum, never the working data directory.
6. Push to the intended GitHub repository and wait for CI. Enable private vulnerability reporting and suitable branch protection. Tag/publish only after the actual hosted checks pass. The local audit does not substitute for the first GitHub run.

The current code targets a source distribution on Linux. Native binary bundles, Windows/macOS support, signed releases and hosted services require separate validation. Mutable upstream export URLs can stop matching pinned hashes; updating those snapshots is a reviewed data change, not a checksum bypass.
