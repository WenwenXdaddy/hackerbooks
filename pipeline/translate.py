"""Translate titles + write a one-line Chinese blurb for new books with Cloudflare Workers AI.

Books that already have an entry in data/translations.json are skipped, so the
hand-curated top-3000 translations are never overwritten. Only books ranked
within --top, or books that appeared after data/cache/known_ids.json was
written (i.e. new to the upstream list), are sent to the model.

Env:
  CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN  (token needs "Workers AI" permission)
  CF_AI_MODEL  optional, defaults to MODEL below

Usage: python translate.py [--top 3000] [--max 300] [--dry-run]
"""
import argparse
import json
import os
import re
import time
import urllib.request

from common import CACHE, DATA, SITE_DATA, UA, load_json, read_books, save_json, shard_of

MODEL = "@cf/qwen/qwen3-30b-a3b-fp8"
TRANS = DATA / "translations.json"
KNOWN = CACHE / "known_ids.json"
BATCH = 12

SYSTEM = """你是一位熟悉中英文出版的图书编辑，为一个中文书架网站整理 Hacker News 读者推荐的书。
对每本书输出：
- z：中文书名。有通行中文译名就用通行译名（如 The Mythical Man-Month → 人月神话）；没有就给一个准确、自然的意译；人名或专有名词作书名时可保留原文。不要加书名号。
- w：一句话推荐语，20 到 40 个汉字，平实、具体，说清楚这本书讲什么、HN 读者为什么推荐它。可以参考给出的读者评论。
  禁止空泛套话和营销腔：不要用“揭示”“深度剖析”“颠覆”“必读”“经典之作”“带你”“打破”“全面”“深刻洞察”等词，不要排比，不要感叹号。
  好的例子：给项目加人只会让它更晚——四十多年过去，工程师们还在引用这句话。
只输出 JSON 数组，每项形如 {"i": "<id>", "z": "...", "w": "..."}，不要输出其他内容。"""

BANNED = re.compile(r"揭示|深度剖析|颠覆|必读|经典之作|带你|打破|全面|深刻洞察|！|!")


def run_model(messages, model):
    acct, token = os.environ["CLOUDFLARE_ACCOUNT_ID"], os.environ["CLOUDFLARE_API_TOKEN"]
    url = f"https://api.cloudflare.com/client/v4/accounts/{acct}/ai/run/{model}"
    body = json.dumps({"messages": messages, "max_tokens": 2400, "temperature": 0.3}).encode()
    req = urllib.request.Request(url, data=body, headers={
        "Authorization": f"Bearer {token}", "Content-Type": "application/json", "User-Agent": UA})
    with urllib.request.urlopen(req, timeout=180) as r:
        d = json.load(r)
    res = d.get("result") or {}
    text = res.get("response")
    if text is None and res.get("choices"):  # OpenAI-compatible response shape
        text = res["choices"][0]["message"]["content"]
    if not isinstance(text, str):
        text = json.dumps(text, ensure_ascii=False)
    return re.sub(r"<think>.*?</think>", "", text, flags=re.S).strip()


def parse(text):
    m = re.search(r"\[.*\]", text, flags=re.S)
    return json.loads(m.group(0)) if m else []


def book_prompt(b, comments):
    lines = [f'id: {b["openlibrary_work"]}', f'书名: {b["title"]}', f'作者: {b["authors"]}',
             f'出版: {b["first_published"]}', f'主题: {b["topics"]}']
    for c in comments[:2]:
        lines.append("读者评论: " + c["x"][:300].replace("\n", " "))
    return "\n".join(lines)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--top", type=int, default=3000)
    ap.add_argument("--max", type=int, default=300, help="max books per run")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    books = read_books()
    trans = load_json(TRANS, {})
    known = set(load_json(KNOWN, []))
    if not known:  # first run: remember the current list so later additions count as "new"
        save_json(KNOWN, sorted(b["openlibrary_work"] for b in books))
        known = {b["openlibrary_work"] for b in books}

    todo = [b for b in books if b["openlibrary_work"] not in trans
            and (int(b["rank"]) <= args.top or b["openlibrary_work"] not in known)][:args.max]
    print(f"{len(todo)} books to translate")
    if args.dry_run or not todo:
        raise SystemExit(0)
    if not os.environ.get("CLOUDFLARE_API_TOKEN"):
        print("CLOUDFLARE_API_TOKEN not set; skipping")
        raise SystemExit(0)

    model = os.environ.get("CF_AI_MODEL") or MODEL
    shards = {}
    done = 0
    for i in range(0, len(todo), BATCH):
        batch = todo[i:i + BATCH]
        parts = []
        for b in batch:
            sid = shard_of(b["openlibrary_work"])
            shards.setdefault(sid, load_json(SITE_DATA / "b" / f"{sid}.json", {}))
            hn = shards[sid].get(b["openlibrary_work"], {}).get("hn", {})
            parts.append(book_prompt(b, hn.get("c", [])))
        msgs = [{"role": "system", "content": SYSTEM},
                {"role": "user", "content": "\n\n---\n\n".join(parts) + "\n\n/no_think"}]
        try:
            items = parse(run_model(msgs, model))
        except Exception as e:  # noqa: BLE001
            print(f"  batch {i}: {e}")
            time.sleep(5)
            continue
        ids = {b["openlibrary_work"] for b in batch}
        for it in items:
            z, w = str(it.get("z", "")).strip(" 《》"), str(it.get("w", "")).strip()
            if it.get("i") in ids and z:
                if BANNED.search(w) or not (8 <= len(w) <= 60):
                    w = ""  # keep the title, drop a weak blurb
                trans[it["i"]] = {"z": z, "w": w, "src": "workers-ai"}
                done += 1
        save_json(TRANS, trans, compact=False)
        print(f"  {min(i + BATCH, len(todo))}/{len(todo)}", flush=True)
    print(f"translated {done}")
