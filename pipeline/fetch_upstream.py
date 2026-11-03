"""Download the public book-level CSV published by hackerbooks.org (by roansh)."""
import urllib.request

from common import UA, UPSTREAM_CSV

URL = "https://hackerbooks.org/data/hackerbooks.csv"

if __name__ == "__main__":
    UPSTREAM_CSV.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(URL, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        body = r.read()
    if not body.startswith(b"rank,openlibrary_work,title"):
        raise SystemExit("Unexpected CSV header; upstream format may have changed")
    old = UPSTREAM_CSV.read_bytes() if UPSTREAM_CSV.exists() else b""
    UPSTREAM_CSV.write_bytes(body)
    print(f"{'unchanged' if old == body else 'updated'}: {body.count(b'\n') - 1} books")
