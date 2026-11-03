"""Merge upstream CSV + covers + HN stats + translations into the site's JSON index."""
import datetime as dt
import glob
import json

from common import CACHE, DATA, SITE_DATA, load_json, read_books, save_json

if __name__ == "__main__":
    books = read_books()
    covers = load_json(CACHE / "covers.json", {})
    trans = load_json(DATA / "translations.json", {})  # {id: {"z": 中文书名, "w": 一句话简介}}
    topics_cfg = load_json(DATA / "topics.json", {})
    hn = {}
    for f in glob.glob(str(SITE_DATA / "b" / "*.json")):
        for wid, v in json.load(open(f, encoding="utf-8")).items():
            if "hn" in v:
                hn[wid] = v["hn"]

    this_year = dt.date.today().year
    out, counts = [], {}
    for b in books:
        wid = b["openlibrary_work"]
        tps = [t.strip() for t in b["topics"].split(";") if t.strip()]
        for t in tps:
            counts[t] = counts.get(t, 0) + 1
        row = {
            "i": wid, "r": int(b["rank"]), "t": b["title"],
            "a": [a.strip() for a in b["authors"].split(";") if a.strip()][:3],
            "y": int(b["first_published"]) if b["first_published"].lstrip("-").isdigit() else None,
            "p": int(b["hn_commenters"] or 0), "m": int(b["hn_mentions"] or 0),
            "e": int(b["hn_recommenders"] or 0),
            "f": int(b["first_mentioned"] or 0), "l": int(b["last_mentioned"] or 0),
            "tp": tps,
        }
        if covers.get(wid):
            row["c"] = covers[wid]
        if wid in trans:
            row.update({k: v for k, v in trans[wid].items() if k in ("z", "w") and v})
        h = hn.get(wid)
        if h:
            row["n1"] = h["y1"]
            years = max(1, this_year - max(row["f"] or 2007, 2007) + 1)
            base = max(1.0, h["all"] / years)
            if h["y1"] >= 5 and years >= 3:
                row["rise"] = round(h["y1"] / base, 2)
        out.append(row)

    save_json(SITE_DATA / "books.json", out)
    save_json(SITE_DATA / "books-top.json", out[:600])  # first paint
    labels = topics_cfg.get("labels", {})
    save_json(SITE_DATA / "topics.json", {
        "groups": [{"name": g["name"], "items": [
            {"s": s, "n": labels.get(s, s), "c": counts.get(s, 0)}
            for s in sorted(g["slugs"], key=lambda s: -counts.get(s, 0))]}
            for g in topics_cfg.get("groups", [])]})
    save_json(SITE_DATA / "meta.json", {
        "generated": dt.date.today().isoformat(), "books": len(out),
        "mentions": sum(r["m"] for r in out),
        "with_comments": sum(1 for r in out if r["i"] in hn),
        "translated": sum(1 for r in out if "z" in r)})
    print(f"wrote {len(out)} books; hn stats for {len(hn)}; translations for {len(trans)}")
