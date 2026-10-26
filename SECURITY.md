# Security and privacy

Scripture Terminal is a local terminal application. Reading, bookmarks, keyword search and prepared semantic search run locally. Import and setup commands contact the documented text hosts, package registries and model repositories. Ask sends the submitted question and retrieved excerpts to OpenAI through the user's installed Codex CLI and ChatGPT login. The app does not implement token storage, copy login tokens, or require an API key. It is not affiliated with OpenAI or Sefaria.

Ask uses temporary working directories, ephemeral threads, read-only permissions and collection-scoped search/read tools. Shell, browsing, plugins and inherited MCP tools are disabled for its threads. Unexpected app-server tool or approval requests fail closed. The local Codex CLI manages authentication; model/service logs and retention remain subject to that service. No sandbox claim protects against a compromised local account, dependency, or CLI binary.

Bookmarks are in `data/study.sqlite`. Development checks can write full questions, answers, and excerpts under `previews/`; these files are excluded from the public source release. Do not upload them when reporting a bug. The optional browser preview binds only to 127.0.0.1 and checks Origin/Host, but grants terminal interaction to local preview clients: do not expose or reverse-proxy it onto a network.

Source checksums intentionally stop imports when upstream content changes. Do not bypass a mismatch without reviewing the new edition, license, reference structure and search-index implications. Source text and model output are evidence, not commands. Citations and retrieval do not guarantee an interpretation is correct.

For a vulnerability, use the repository's private **Report a vulnerability** mechanism once enabled by the maintainer. If it is unavailable, contact the maintainer through their published profile and request a private channel before sharing details. Do not put credentials, personal questions, local databases, exploit details, or private logs in a public issue. There is no dedicated security response SLA for this initial release.
