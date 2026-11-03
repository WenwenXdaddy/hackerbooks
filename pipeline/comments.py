"""Fetch HN comments that mention each book (via the public HN Algolia API).

For every book we store a handful of representative comment excerpts plus
two counts used for the "rising" list:
  all  - comments matching the title query, all time
  y1   - same query, last 365 days

Results are written straight into the per-book detail shards
(site/data/b/<shard>.json), which double as the cache. Resumable.

Usage: python comments.py [--limit N] [--refresh-days D] [--top N]
"""
import argparse
import html
import re
import time
from concurrent.futures import ThreadPoolExecutor

from common import SITE_DATA, http_json, load_json, read_books, save_json, shard_of

API = "https://hn.algolia.com/api/v1/search"
CUES = re.compile(
    r"\b(recommend|must[- ]read|favou?rite|changed (my|how)|best (book|i)|loved|"
    r"highly|classic|re-?read|life[- ]changing|eye[- ]opening|worth (it|reading)|"
    r"masterpiece|essential|great book|fantastic|brilliant)\b", re.I)
NEG = re.compile(r"\b(overrated|terrible|awful|waste of time|don'?t (read|bother)|hated)\b", re.I)


def clean(text: str) -> str:
    text = re.sub(r"<p>", "\n\n", text or "")
    text = re.sub(r"<a [^>]*href=\"([^\"]+)\"[^>]*>[^<]*</a>", r"\1", text)
    text = re.sub(r"<[^>]+>", "", text)
    return html.unescape(text).strip()


def norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", s.lower()).strip()


def main_title(title: str) -> str:
    t = re.split(r"\s*[:;(]\s*", title)[0].strip()
    return t if len(t) >= 3 else title


def is_ambiguous(t: str) -> bool:
    return len(norm(t).split()) <= 1 or len(t) < 9


def title_regex(title: str) -> re.Pattern:
    words = re.findall(r"[A-Za-z0-9\u00C0-\uFFFF]+", title)
    return re.compile(r"[^A-Za-z0-9]{0,4}".join(map(re.escape, words)), re.I)


def excerpt(text: str, m: re.Match | None, width: int = 520) -> str:
    if len(text) <= width:
        return text
    i = max(0, (m.start() if m else 0) - 140)
    snippet = text[i:i + width]
    if i > 0:
        snippet = "…" + snippet[snippet.find(" ") + 1:]
    return snippet.rsplit(" ", 1)[0] + "…"


def fetch_book(b: dict, keep: int) -> dict:
    title = main_title(b["title"])
    last = (b["authors"].split(";")[0].strip().split() or [""])[-1]
    amb = is_ambiguous(title)
    query = f'"{title}"' + (f" {last}" if amb and last else "")
    base = {"query": query, "tags": "comment", "typoTolerance": "false",
            "attributesToRetrieve": "objectID,author,created_at_i,story_id,story_title,comment_text",
            "attributesToHighlight": "none"}
    d = http_json(API, {**base, "hitsPerPage": 60})
    y1 = http_json(API, {**base, "hitsPerPage": 0,
                         "numericFilters": f"created_at_i>{int(time.time()) - 365 * 86400}"})
    rx, nl = title_regex(title), norm(last)
    scored = []
    for h in d.get("hits", []):
        text = clean(h.get("comment_text"))
        m = rx.search(text)
        if not m or (amb and nl and nl not in norm(text)) or len(text) < 80:
            continue
        near = text[max(0, m.start() - 200):m.end() + 200]
        s = 2.0 * len(CUES.findall(near)) - 2.0 * len(NEG.findall(near))
        s += 1.0 if 150 <= len(text) <= 1200 else -1.0
        s -= 0.5 * max(0, len(re.findall(r"\n\s*[-*\d]", text)) - 2)  # long lists of books
        s -= 0.3 * max(0, len(re.findall(r"\bby [A-Z]", text)) - 1)
        s += 0.5 if m.start() < 200 else 0.0
        scored.append((s, h["created_at_i"], {
            "id": h["objectID"], "by": h.get("author"), "t": h["created_at_i"],
            "sid": h.get("story_id"), "st": h.get("story_title") or "",
            "x": excerpt(text, m)}))
    scored.sort(key=lambda x: (-x[0], -x[1]))
    return {"q": query, "all": d.get("nbHits", 0), "y1": y1.get("nbHits", 0),
            "fetched": int(time.time()), "c": [c for _, _, c in scored[:keep]]}


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0, help="max books to fetch this run")
    ap.add_argument("--top", type=int, default=0, help="only consider the top N books by rank")
    ap.add_argument("--refresh-days", type=float, default=0,
                    help="re-fetch books whose data is older than D days")
    ap.add_argument("--delay", type=float, default=0.5, help="pause per book per worker (rate limit)")
    ap.add_argument("--workers", type=int, default=3)
    args = ap.parse_args()

    books = read_books()
    if args.top:
        books = books[:args.top]
    shards: dict[str, dict] = {}

    def shard(sid):
        if sid not in shards:
            shards[sid] = load_json(SITE_DATA / "b" / f"{sid}.json", {})
        return shards[sid]

    cutoff = time.time() - args.refresh_days * 86400 if args.refresh_days else None
    todo = []
    for b in books:
        cur = shard(shard_of(b["openlibrary_work"])).get(b["openlibrary_work"], {}).get("hn")
        if cur is None or (cutoff and cur["fetched"] < cutoff):
            todo.append(b)
    if args.limit:
        todo = todo[:args.limit]
    print(f"{len(todo)} books to fetch", flush=True)

    dirty = set()

    def work(b):
        time.sleep(args.delay)
        try:
            return b, fetch_book(b, 6 if int(b["rank"]) <= 3000 else 3)
        except Exception as e:  # noqa: BLE001
            print(f"  skip {b['openlibrary_work']}: {e}", flush=True)
            return b, None

    # Algolia allows ~10k requests/hour per IP; each book costs 2 requests.
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        for i, (b, res) in enumerate(pool.map(work, todo), 1):
            if res is not None:
                wid = b["openlibrary_work"]
                sid = shard_of(wid)
                shard(sid).setdefault(wid, {})["hn"] = res
                dirty.add(sid)
            if i % 100 == 0 or i == len(todo):
                for s in dirty:
                    save_json(SITE_DATA / "b" / f"{s}.json", shards[s])
                dirty.clear()
                print(f"  {i}/{len(todo)}", flush=True)
