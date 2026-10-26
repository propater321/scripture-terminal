"""Import a pinned OpenBible cross-reference snapshot without changing Bible text or bookmarks."""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import re
import sqlite3
import tempfile
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / 'data'
URL = 'https://a.openbible.info/data/cross-references.zip'
EXPECTED_SHA256 = '8cff4d0eb417cfda226ea82759a1481a392977dea5d511e70157d753e40d2c73'
SOURCE_DATE = '2026-10-19'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, help='Use a local TSV instead of downloading the pinned snapshot')
    args = parser.parse_args()
    DATA.mkdir(exist_ok=True)
    cache = DATA / 'cross-references.tsv'
    if args.source or cache.exists():
        text = (args.source or cache).read_text(encoding='utf-8-sig')
    else:
        with urllib.request.urlopen(URL, timeout=30) as response:
            archive = response.read(10_000_001)
        if len(archive) > 10_000_000:
            raise ValueError('Unexpected cross-reference archive size')
        with zipfile.ZipFile(io.BytesIO(archive)) as source:
            entry = next(item for item in source.infolist() if item.filename.endswith('.txt'))
            if entry.file_size > 20_000_000:
                raise ValueError('Unexpected cross-reference text size')
            text = source.read(entry).decode('utf-8-sig')
    text = text.replace('\r\n', '\n').replace('\r', '\n').rstrip() + '\n'
    digest = hashlib.sha256(text.encode()).hexdigest()
    if digest != EXPECTED_SHA256:
        raise ValueError('The source differs from the reviewed snapshot. Existing data was left intact; review the new snapshot before updating its hash.')
    bible = sqlite3.connect(f'file:{DATA / "bible.sqlite"}?mode=ro', uri=True)
    books = dict(bible.execute('SELECT osis,id FROM books'))
    known = {b * 1_000_000 + c * 1000 + v for b, c, v in bible.execute('SELECT DISTINCT book_id,chapter,verse FROM verses')}
    bible.close()

    def address(value):
        match = re.fullmatch(r'([1-3]?[A-Za-z]+)\.(\d+)\.(\d+)', value)
        if not match or match[1] not in books or not 0 < int(match[2]) < 1000 or not 0 < int(match[3]) < 1000:
            raise ValueError(f'Invalid reference: {value}')
        return books[match[1]] * 1_000_000 + int(match[2]) * 1000 + int(match[3])

    rows = []
    unavailable = 0
    for line in text.splitlines()[1:]:
        source, target, votes, *_ = line.split('\t')
        parts = target.split('-')
        start, end = address(parts[0]), address(parts[-1])
        if start > end:
            raise ValueError(f'Reversed range: {target}')
        source_key = address(source)
        unavailable += int(source_key not in known or start not in known or end not in known)
        rows.append((source_key, start, end, int(votes), source, target))
    if len(rows) != 344799:
        raise ValueError('Unexpected number of cross-references')
    metadata = dict(source='OpenBible.info', sourcePage='https://www.openbible.info/labs/cross-references/', url=URL, license='CC BY 4.0', licenseUrl='https://creativecommons.org/licenses/by/4.0/', snapshot=SOURCE_DATE, sha256=digest, rows=len(rows), rowsWithUnavailableEndpoints=unavailable, changes='TSV normalized to UTF-8/LF with a final newline and indexed in SQLite. Original references and votes preserved; missing corpus endpoints retained without replacement.')
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=DATA, prefix='crossrefs-', suffix='.sqlite', delete=False) as file:
            temporary = Path(file.name)
        with sqlite3.connect(temporary) as db:
            db.execute('CREATE TABLE links (source_key INTEGER NOT NULL, target_start INTEGER NOT NULL, target_end INTEGER NOT NULL, votes INTEGER NOT NULL, source_ref TEXT NOT NULL, target_ref TEXT NOT NULL, PRIMARY KEY(source_key,target_start,target_end))')
            db.executemany('INSERT INTO links VALUES (?,?,?,?,?,?)', rows)
            db.execute('CREATE INDEX source_rank ON links(source_key,votes DESC)')
            db.execute('CREATE TABLE metadata (json TEXT NOT NULL)')
            db.execute('INSERT INTO metadata VALUES (?)', (json.dumps(metadata),))
        db.close()
        os.replace(temporary, DATA / 'crossrefs.sqlite')
        temporary = None
        cache.write_text(text)
        (DATA / 'crossrefs-source.json').write_text(json.dumps(metadata, indent=2) + '\n')
        print(f'{len(rows):,} cross-references imported; {unavailable} rows contain endpoints absent from the installed texts.')
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


if __name__ == '__main__':
    main()
