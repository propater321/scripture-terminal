# UI captures

The four PNGs here show Scripture Terminal's real OpenTUI output at 140 × 44 cells. They are captured with `testRender` and rasterized from `captureSpans` with the same colors and cell positions. Font rendering can differ from a user's terminal. No UI elements or answers were invented for the images.

- `read.png`: Bible reader, keyword results, KJV comparison and Atlas.
- `explore.png`: Bible book explorer and the original Genesis navigation summary.
- `torah.png`: Genesis in the named Hebrew Tanach edition and JPS 1917 English.
- `ask.png`: Ask's ready state, before submitting any question.

The small displayed KJV/WEB and Torah excerpts come from the editions marked Public Domain by their upstream sources in [the Bible manifest](../../sources/bible-manifest.json) and [the Torah manifest](../../sources/torah-manifest.json). This is attribution to those labels, not worldwide rights clearance; see [NOTICE.md](../../NOTICE.md). No noncommercial Talmud/Midrash excerpt, saved question, generated answer, bookmark or account detail is included.

To reproduce after importing Bible and Torah, install Pillow and the DejaVu fonts, then run:

```sh
bun scripts/capture-public.tsx
```

The script defaults to `.venv-search/bin/python`; set `SCRIPTURE_CAPTURE_PYTHON` to another Python with Pillow if needed. Raw captures stay under ignored `previews/`; only these four reviewed documentation images are public.
