"""Look up Open Library cover ids for every work, 100 works per search request."""
import time

from common import CACHE, http_json, load_json, read_books, save_json

PATH = CACHE / "covers.json"  # {work_id: cover_id | 0}

if __name__ == "__main__":
    covers = load_json(PATH, {})
    todo = [b["openlibrary_work"] for b in read_books() if b["openlibrary_work"] not in covers]
    print(f"{len(todo)} works need cover lookup")
    for i in range(0, len(todo), 100):
        batch = todo[i:i + 100]
        q = "key:(" + " OR ".join(f'"/works/{w}"' for w in batch) + ")"
        d = http_json("https://openlibrary.org/search.json",
                      {"q": q, "fields": "key,cover_i", "limit": 100})
        found = {doc["key"].split("/")[-1]: doc.get("cover_i") or 0 for doc in d.get("docs", [])}
        for w in batch:
            covers[w] = found.get(w, 0)
        save_json(PATH, covers)
        print(f"  {i + len(batch)}/{len(todo)}", flush=True)
        time.sleep(1)
    print(f"done: {sum(1 for v in covers.values() if v)} / {len(covers)} have covers")
