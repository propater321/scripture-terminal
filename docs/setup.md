# Local setup for people and coding agents

Start with the minimal Bible setup, then add the libraries and models you need. The GitHub repository and release archives contain source code, not the full text databases or model weights. The import commands below download and build those locally; no manual SQLite download or database server is needed.

Agents should also read [AGENTS.md](../AGENTS.md). Run commands from the repository root and stop a command sequence when a step fails. Reading and keyword search need neither a Codex account nor a GPU.

## 1. Prerequisites

The validated platform is **Linux x64**, with **Bun 1.4.4**, **Python 3.12+**, Git and a UTF-8 terminal. Hebrew/Aramaic display requires the system FriBidi library. Optional semantic search uses **uv**, a separate Python 3.12 environment and downloaded CPU models. Plan for roughly 4 GB for the full development data/model set, with extra space for dependencies and temporary builds; a Bible-only install is smaller.

Check what is already installed:

```sh
uname -sm
git --version
bun --version
python3 --version
```

On Ubuntu 24.04, missing system prerequisites can be installed with:

```sh
sudo apt-get update
sudo apt-get install git curl unzip python3 python3-venv libfribidi0
```

On Arch, the corresponding FriBidi package is `fribidi`. Use the machine's existing package/version manager when available. Agents should stay within the user's authorized system-install scope.

For a new Bun installation, the [official Bun installer](https://bun.sh/docs/installation#installing-older-versions) accepts the release tag:

```sh
curl -fsSL https://bun.com/install | bash -s "bun-v1.4.4"
export PATH="$HOME/.bun/bin:$PATH"
bun --version
```

Only if you want semantic search and do not have uv, install it using the [official uv instructions](https://docs.astral.sh/uv/getting-started/installation/):

```sh
curl -LsSf https://astral.sh/uv/install.sh | sh
export PATH="$HOME/.local/bin:$PATH"
uv --version
```

## 2. Minimal working installation

```sh
git clone https://github.com/propater321/scripture-terminal.git
cd scripture-terminal
bun install --frozen-lockfile
bun run check:release
bun run import
bun run import:links
bun run doctor
bun run test:integration
bun scripts/check-explore.ts
```

`import` downloads pinned KJV and WEB files and builds `data/bible.sqlite`. `import:links` downloads the pinned OpenBible cross-reference snapshot and builds `data/crossrefs.sqlite`. Imports validate cached files too. Source-only development can stop after `check:release`; the commands that follow verify the installed app.

Expected results: `doctor` reports the Bible text as installed; optional libraries/models may be absent. The integration runner requires the Bible databases and runs the available suites, explicitly skipping optional-library suites. The native Explore check launches its own PTY, exercises navigation, mouse interaction and compact layouts, then exits. It works in an unattended agent shell and makes no model requests.

For interactive use, open a real terminal of at least **60 columns × 18 rows** and run:

```sh
./bin/scripture
```

Press `/` for a passage or keyword, `x` to Explore, `i` for Ask, `F5` for libraries, `?` for help and `q` to quit. A piped shell should use `./bin/scripture --help`, `--version` or the smoke checks instead of leaving the interactive app running.

## 3. Download more text libraries

Bible is the startup prerequisite even when you intend to read another library. Add Torah and/or any of the six additional collections:

```sh
bun run import:torah
bun run import:jewish --library mishnah
```

Replace `mishnah` with `bavli`, `yerushalmi`, `midrash`, `zohar` or `shulchan`. To import all six, use `bun run import:jewish` without a library argument. Each creates its own `data/<library>.sqlite`; Torah creates `data/torah.sqlite`. Launch with `./bin/scripture torah`, `./bin/scripture mishnah`, etc., or use F5.

For every supported text library and its available connections, run this sequence after the minimal setup:

```sh
bun run import:torah
bun run import:jewish
bun run import:torah-links
bun run import:jewish-links
bun run doctor
bun run test:integration --all
bun scripts/check-torah.ts
bun scripts/check-jewish-terminal.ts
```

**Ordering matters:** Torah links require Torah text. The current Jewish connection importer requires **all six** added text libraries, even if you only use one. You can read and search an individual library without those connection databases. The selected Zohar export has no reliably mapped cross-references; its Context and Topics features still work.

Named editions, source URLs, expected hashes and coverage are recorded in [`sources/`](../sources/) and shown in the app's Sources view. These include Sefaria text exports, Sefaria connection snapshots and the Bible/OpenBible sources. Some upstream URLs are mutable: a checksum mismatch stops the import and requires a reviewed snapshot update. Selected texts have noncommercial terms; see [NOTICE.md](../NOTICE.md).

Some Jewish imports regenerate tracked provenance timestamps. Check `git diff -- sources/` afterward; routine setup is not a reason to commit timestamp changes or new source hashes.

## 4. Enable local meaning search and refinement

Keyword search already works after importing text. Run the following once to create `.venv-search`, install hash-locked dependencies and cache the Bible embedding/reranking models, then build its index:

```sh
bun run setup:search
bun run index:semantic
bun scripts/evaluate-search.ts
```

The setup command selects Python 3.12 through uv. Do not reinstall the environment before every launch; subsequent search uses the local runtime and model cache.

For Torah or any added Jewish library, prepare the shared multilingual models after `setup:search`. Build only the indexes whose texts you installed:

```sh
bun run setup:torah-search
bun run index:torah
bun run index:jewish mishnah
```

`index:torah` needs Torah text; `index:jewish mishnah` needs Mishnah text. For all six added libraries:

```sh
bun run index:jewish bavli yerushalmi mishnah midrash zohar shulchan
```

Indexing runs on the CPU and may take time. Run builds sequentially to avoid competing for memory. Models and embeddings stay local. Missing or stale indexes produce an explicit keyword fallback; rebuild the affected index after changing its source database.

After a complete text, connection and model setup, these deeper checks are available:

```sh
bun scripts/check-torah-search.ts
bun scripts/check-jewish-search.ts
python3 scripts/check-jewish-data.py
```

The last check requires all six added text and connection databases, their cached source files, and the Bible and Torah semantic indexes. It is not a minimal-install check. Search reports go under ignored `previews/`.

## 5. Optional Ask setup

Follow [Ask through Codex](../README.md#ask-through-codex) to install the Codex CLI and sign in with your own managed ChatGPT login. This app was tested with CLI 0.164.0 and uses an experimental interface. An API key is not a substitute for its supported login.

The person using the account should complete login. An agent should not copy credentials between machines or read token files. Open Ask with `i` after local setup; semantic search is optional, but helps retrieve relevant passages for broad questions.

Live research checks submit a question and consume the account's allowance. They are not part of ordinary installation or CI. Use `bun run check:research` only when live Ask validation is intended. Questions and retrieved excerpts go to OpenAI; see [SECURITY.md](../SECURITY.md).

## 6. Data, updates and troubleshooting

| Location | Contents |
| --- | --- |
| `data/bible.sqlite`, `data/torah.sqlite`, `data/<library>.sqlite` | Installed text, references and keyword indexes |
| `data/crossrefs.sqlite`, `data/torah-links.sqlite`, `data/<library>-links.sqlite` | Optional connections |
| `data/semantic.sqlite`, `data/torah-semantic.sqlite`, `data/<library>-semantic.sqlite` | Optional passage embeddings |
| `data/models/`, `data/torah-models/` | Downloaded model artifacts |
| `data/study.sqlite` | Personal bookmarks; preserve this file |
| `.venv-search/` | Optional Python search environment |
| `previews/` | Generated evaluation/capture/answer files, ignored except the development HTML |

Stop the app before backing up bookmarks or replacing a checkout. Preserve `data/` when updating the source; use `bun install --frozen-lockfile` with the new lockfile. Text imports are not required on every launch. If a corpus changes, rebuild its connections and semantic index. A complete local setup can read and search offline; initial downloads and Ask need network access.

| Symptom | Next step |
| --- | --- |
| `bun: command not found` or wrong version | Check the active version manager and PATH; use Bun 1.4.4 for the validated setup. |
| “Download the text first” | Run `bun run import` from the checkout. Bible is needed even for an optional-library launch. |
| “Open in a terminal” | Launch in a real TTY; use the PTY smoke scripts for unattended checks. |
| Hebrew display error | Install the system FriBidi library (`libfribidi.so.0`) and restart. English reading is available without it. |
| Meaning search falls back to keywords | Prepare the correct models and build the selected library's index. Rebuild after a corpus change. `doctor` reports runtime presence, not successful retrieval; use the relevant search check. |
| Missing connections | Import the connection dataset after its required texts. Zohar's lack of mapped links is expected for this export. |
| Checksum mismatch | Preserve existing data and report the source/file mismatch. Do not change expected hashes, disable validation or keep retrying a changed upstream snapshot. |
| Ordinary download timeout | Retry the same import after connectivity recovers; valid cached files are reused. |
| `bun test` reports skipped suites | Install the relevant databases and run `test:integration` or `test:integration --all`; skips are not evidence that those features work. |
| Release checks fail outside Git | Use a Git clone for `check:release` and source packaging. In an extracted archive, use `bun run check`, `bun run test:unit` and `bun run check:imports` instead. |

When handing setup back to a user, report which libraries, connections and semantic indexes were installed, which checks passed or skipped, and the exact launch command. Do not describe a keyword-only install as having validated semantic search or Ask.
