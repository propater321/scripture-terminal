# Licenses and attribution

The application's original source code is licensed under MIT; see LICENSE. This does not relicense third-party software, model weights, source texts, translations, commentary, or link datasets.

The source release contains importers and provenance manifests, **not downloaded corpora or models**. SQLite files, model caches, bookmarks, unreviewed rendered previews, and generated answers under `data/` and `previews/` are excluded from Git and the source archive. Do not attach a working `data/` directory to a release. The four curated UI images in `docs/images/` include small Bible/Torah excerpts and have their own [capture and attribution note](docs/images/README.md).

| Material | Source / applicable terms |
| --- | --- |
| KJV and WEB snapshot | [midvash/bible-data](https://github.com/midvash/bible-data), upstream marks these texts Public Domain; pinned revision, URLs and checksums in `sources/bible-manifest.json` |
| Bible cross-references | [OpenBible.info](https://www.openbible.info/labs/cross-references/), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/); line endings normalized and references indexed |
| Torah | Sefaria named Hebrew Tanach and English JPS 1917 editions, marked Public Domain in their exports; `sources/torah-manifest.json` |
| Babylonian Talmud | [William Davidson editions](https://www.sefaria.org/william-davidson-talmud), **CC-BY-NC**; `sources/bavli-manifest.json` |
| Jerusalem Talmud | Heinrich Guggenheimer editions, **CC-BY**; `sources/yerushalmi-manifest.json` |
| Mishnah and Midrash | Per-edition Public Domain, CC0, CC-BY, CC-BY-SA, or CC-BY-NC; every imported edition and its attribution URL is named in the corresponding manifest. The original Beeri Mekhilta is CC-BY-NC. |
| Zohar | *The Zohar; London, Soncino Press, 1933*, English edition marked Public Domain by Sefaria; `sources/zohar-manifest.json` |
| Shulchan Aruch | Named Lemberg original editions marked Public Domain; Sefaria Community Translation CC0; `sources/shulchan-manifest.json` |
| Sefaria connections and summaries | [Sefaria Export](https://github.com/Sefaria/Sefaria-Export) and its per-material terms; source URLs and checksums retained in manifests; unavailable references excluded |
| Embeddings | BGE-small-en-v1.5 and multilingual E5-small, MIT, downloaded separately |
| Rerankers | Xenova/ms-marco-MiniLM-L-6-v2 and BGE reranker v2-m3, Apache-2.0, downloaded separately |

Sefaria text imports flatten HTML, retain the original HTML, extract inline edition footnotes, and preserve canonical references. These transformations and attribution details are recorded in the manifests and the app's Sources view. Summaries in the Bible view are original navigation aids; summaries in the added libraries come from Sefaria metadata.

**CC-BY-NC material remains noncommercial even though the app code is MIT.** Check each edition's actual terms before redistribution or commercial use. Public-domain labels reflect upstream metadata and are not a worldwide rights clearance. The pinned Bible snapshot has not been exhaustively collated against a publisher's authoritative edition.

Installed JavaScript and Python dependencies retain their own licenses. Dependency versions and integrity hashes are in `bun.lock` and `scripts/requirements-search.lock`; their license files are distributed by the package publishers. Model licenses and artifact hashes are recorded during local index creation. Codex model access is a separate service, subject to the user's account and provider terms; it is not included in the MIT license.
