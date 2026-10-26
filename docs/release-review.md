# Release review — 2026-10-26

Candidate: **Scripture Terminal 0.1.0**, Linux x64 source release. The local checks below passed. Publication still depends on the first hosted GitHub CI run; this review does not claim validation on other platforms or exhaustive correctness of source texts, search, or interpretations.

## Changes made for release

- Added the MIT code license, separate data/model notices, contribution and security guidance, release procedure, portable setup instructions and setup diagnostics.
- Excluded downloaded texts, databases, bookmarks, models, generated answers and unreviewed captures from Git and the source archive. Packaging checks the file list and produces a SHA-256 checksum. Credential scanning is heuristic, not a guarantee.
- Pinned Bible sources and validated their checksums and structure before atomic database replacement. Python import validation now remains active with `python -O`. Fresh-cache directory creation was fixed.
- Updated FastEmbed to 0.9.1 and Pillow to 13.0.0 after the Python dependency audit identified advisories in the previous Pillow version. Rebuilt the hashed Python lockfile and verified actual retrieval and reranking with the new runtime.
- Pinned direct JavaScript dependencies, separated preview-only dependencies, corrected CLI metadata and mode validation, and added clearer missing/corrupt-data diagnostics.
- Added isolated Codex protocol tests, source-only tests, import tests and pinned GitHub Actions. Preview checks now wait for completed search submission and inspect the visible focused layout.

## Verification

| Check | Result |
| --- | --- |
| TypeScript type checking | Passed |
| TypeScript tests | 66 passed: 57 corpus/integration tests and 9 source-only unit tests |
| Python import tests | 5 passed |
| Native terminal | Bible, Torah and all six added libraries passed launch, navigation, library switching, compact 60 × 18 layout and clean exit checks; Bible checks also exercised real mouse hover/click |
| Local development preview | All four layouts passed live PTY input, reference jumps and reading; localhost-origin and response-header checks passed |
| Data integrity | Source counts, checksums, native connection endpoints and existing Bible/Torah semantic-index fingerprints passed |
| Search runtime | 24 Torah/added-library retrieval and refinement cases passed after the dependency update; the 12-query Bible development set was evaluated in four search modes |
| Live Ask | Codex CLI 0.164.0 completed a Bavli question with 3 retrieval tool calls and 12 validated citations |
| Dependency audits | Bun and the locked optional Python runtime reported no known vulnerabilities at review time |
| Clean source installation | Frozen dependency installation, source tests, fresh Bible and connections import, Bible integration tests and native keyword-only operation passed; fresh Torah and Zohar imports also passed |
| Damaged cache | Modified Bible and Torah sources were rejected without changing the installed databases; Torah was also checked with Python optimization enabled |

The small development search set is not an exhaustive relevance benchmark. Live citation checks establish that cited passages exist among retrieved sources; they do not certify the answer's interpretation.

## Remaining release conditions and limits

1. Push to the intended repository and require its actual GitHub checks to pass before tagging. No repository or release was published during this review. Configure private vulnerability reporting and branch protection there.
2. Distribute only the source archive and its checksum. Texts and models download separately under their own terms. Selected Davidson Talmud and original Beeri Mekhilta materials have noncommercial terms; upstream public-domain labels are not worldwide rights clearance.
3. Label this as an initial Linux source release. Binary distribution and Windows/macOS support have not been validated.
4. Keep Ask optional. It uses the experimental Codex app-server dynamic-tool interface and the user's own managed login; account access, usage limits and future CLI compatibility remain external dependencies.
5. Keep coverage gaps visible: the selected Zohar export is English-only with no mapped cross-references, and other libraries have partial language coverage. Cross-library questions and comparisons are not implemented.

Repeat the relevant checks when code, data manifests, dependencies or supported platforms change; see [release-checklist.md](release-checklist.md).
