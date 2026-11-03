"""Shared helpers for the data pipeline (stdlib only)."""
import csv
import json
import os
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
CACHE = DATA / "cache"
SITE_DATA = ROOT / "site" / "data"
UPSTREAM_CSV = DATA / "upstream" / "hackerbooks.csv"
UA = "hackerbooks-cn/1.0 (+https://books.jiadi.ai)"
N_SHARDS = 256


def shard_of(book_id: str) -> str:
    """FNV-1a 32-bit hash -> 2-hex-digit shard. Mirrored in functions/b/[id].js."""
    h = 0x811C9DC5
    for ch in book_id.encode():
        h ^= ch
        h = (h * 0x01000193) & 0xFFFFFFFF
    return f"{h % N_SHARDS:02x}"


def http_json(url: str, params: dict | None = None, retries: int = 4, timeout: int = 30):
    if params:
        url = url + "?" + urllib.parse.urlencode(params)
    delay = 2.0
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.load(r)
        except Exception as e:  # noqa: BLE001 - network flakiness, retry
            if attempt == retries - 1:
                raise
            print(f"  retry {attempt + 1} after {e}", flush=True)
            time.sleep(delay)
            delay *= 2


def read_books():
    with open(UPSTREAM_CSV, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def load_json(path: Path, default):
    if path.exists():
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    return default


def save_json(path: Path, obj, compact: bool = True):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        if compact:
            json.dump(obj, f, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
        else:
            json.dump(obj, f, ensure_ascii=False, indent=1, sort_keys=True)
    os.replace(tmp, path)
