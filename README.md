# 黑客书架 · Hacker Books 中文版

Hacker News 评论里被反复提起和推荐的书，中文书架。线上地址：<https://books.jiadi.ai>

## 数据来源与致谢

- **书目、提及人数、推荐人数**：[hackerbooks.org](https://hackerbooks.org/about)（作者 [roansh](https://x.com/roansh_)）公开发布的 [CSV 数据集](https://hackerbooks.org/data/hackerbooks.csv)
- **书籍元数据与封面**：[Open Library](https://openlibrary.org)
- **评论摘录、近一年提及数**：[HN Search API (Algolia)](https://hn.algolia.com/api)，评论版权归原作者，均链接回原帖
- **字体**：Noto Serif SC、Newsreader（SIL Open Font License，见 `site/fonts/`）

本站与 Y Combinator / Hacker News 无从属关系。

## 结构

```
pipeline/            数据流水线（Python 标准库，无第三方依赖）
  fetch_upstream.py  下载 hackerbooks.org 的 CSV
  covers.py          批量查询 Open Library 封面 id（每次 100 本）
  comments.py        通过 HN Algolia 抓取评论摘录与近一年提及数（可断点续跑）
  translate.py       用 Cloudflare Workers AI 为新书生成中文书名与推荐语（不覆盖已有条目）
  build.py           合并为站点 JSON：site/data/books.json 等
data/
  upstream/          上游 CSV
  cache/covers.json  封面 id 缓存
  topics.json        主题中文名与分组
  translations.json  （可选）中文书名 z / 一句话简介 w，按 Open Library work id
site/                静态站点（无构建步骤），Cloudflare Pages 输出目录
  data/b/xx.json     每本书的评论摘录，按 id 哈希分成 256 个分片
functions/cover/     Pages Function：经 Cloudflare 边缘缓存代理 Open Library 封面
.github/workflows/   每周一自动更新数据并提交
```

## 本地运行

```bash
python3 pipeline/build.py          # 由缓存重新生成 site/data
npx wrangler pages dev site        # 本地预览（含 Functions）
```

## 部署（Cloudflare Pages）

1. Cloudflare 控制台 → Workers & Pages → Create → Pages → 连接 GitHub 仓库
2. Framework preset：None；Build command：留空；Build output directory：`site`
3. 部署完成后在项目的 Custom domains 中添加 `books.jiadi.ai`

推送到 `main` 即自动部署；GitHub Actions 每周更新数据后也会触发部署。

## 新书自动翻译（Cloudflare Workers AI）

在仓库 Settings → Secrets and variables → Actions 中添加：

- Secret `CLOUDFLARE_ACCOUNT_ID`：Cloudflare 账户 ID
- Secret `CLOUDFLARE_API_TOKEN`：权限包含 **Workers AI: Read/Edit** 的 API Token
- （可选）Variable `CF_AI_MODEL`：模型名，默认 `@cf/qwen/qwen3-30b-a3b-fp8`

未配置时该步骤会自动跳过，新书保留英文书名。
