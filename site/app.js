// 黑客书架 — single-page app. No framework, no build step.
const COVER = (id, size = 'M') => `/cover/${id}-${size}.jpg`; // proxied by functions/cover/[name].js
const PAGE = 60;
const THIS_YEAR = new Date().getFullYear();
const $main = document.getElementById('main');

// ---------- data ----------
const json = (u) => fetch(u).then((r) => { if (!r.ok) throw new Error(u + ' ' + r.status); return r.json(); });
let TOP, ALL, TOPICS, META;
const BYID = new Map(); // every book we have seen so far, for cover fallbacks
const index = (rows) => { for (const b of rows) BYID.set(b.i, b); return rows; };
const loadTop = () => (TOP ??= json('/data/books-top.json').then(index));
const loadAll = () => (ALL ??= json('/data/books.json').then(index));
const loadTopics = () => (TOPICS ??= json('/data/topics.json'));
const loadMeta = () => (META ??= json('/data/meta.json'));

function fnv(s) { // mirrors pipeline/common.py shard_of
  let h = 0x811c9dc5;
  for (const c of new TextEncoder().encode(s)) { h ^= c; h = Math.imul(h, 0x01000193) >>> 0; }
  return (h % 256).toString(16).padStart(2, '0');
}

// ---------- local state ----------
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const shelf = new Set(store.get('hb.shelf', []));
const toggleShelf = (id) => { shelf.has(id) ? shelf.delete(id) : shelf.add(id); store.set('hb.shelf', [...shelf]); return shelf.has(id); };

// ---------- helpers ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => (n ?? 0).toLocaleString('en-US');
const authors = (b) => (b.a || []).join('、');
const PH = ['#5f6b57', '#7a4a3a', '#3f5268', '#8a6a3f', '#5d4e6b', '#6b3f48', '#4d6560', '#7b5a43'];
const phColor = (id) => PH[parseInt(fnv(id), 16) % PH.length];
function seeded(seed) { // mulberry32
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const todaySeed = () => { const d = new Date(); return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); };

function cover(b, size = 'M') {
  if (b.c) return `<div class="cv"><img src="${COVER(b.c, size)}" alt="" loading="lazy" decoding="async" onerror="this.parentNode.outerHTML=window.__ph('${b.i}')"></div>`;
  return placeholder(b);
}
function placeholder(b) {
  return `<div class="cv ph" style="--ph:${phColor(b.i)}"><b>${esc(b.t)}</b><i>${esc((b.a || [])[0] || '')}</i></div>`;
}
window.__ph = (id) => { const b = BYID.get(id); return b ? placeholder(b) : '<div class="cv ph"></div>'; };

function card(b, opts = {}) {
  const zh = b.z;
  return `<a class="card" href="/b/${b.i}" data-link data-id="${b.i}">
    ${cover(b)}${opts.rank ? `<span class="rank">${opts.rank}</span>` : ''}
    <h3>${esc(zh || b.t)}</h3>
    ${zh ? `<div class="en">${esc(b.t)}</div>` : ''}
    <div class="au">${esc(authors(b))}</div>
    <div class="stat">${opts.stat ? opts.stat(b) : `<b>${fmt(b.e)}</b> 人推荐 · ${fmt(b.p)} 人提及`}</div>
    ${b.w && !opts.small ? `<p class="w">${esc(b.w)}</p>` : ''}
  </a>`;
}

// ---------- filters ----------
const DECADES = [['', '全部'], ['<1950', '1950 年前'], ...[1950, 1960, 1970, 1980, 1990, 2000, 2010, 2020].map((d) => [String(d), `${d} 年代`])];
const FIRST = [['', '全部'], ['2015', '2015 年起'], ['2020', '2020 年起'], ['2025', '2025 年起']];
function applyFilters(rows, f) {
  return rows.filter((b) => {
    if (f.dec) {
      if (b.y == null) return false;
      if (f.dec === '<1950') { if (b.y >= 1950) return false; }
      else if (Math.floor(b.y / 10) * 10 !== +f.dec) return false;
    }
    if (f.first && b.f < +f.first) return false;
    return true;
  });
}
function filterBar(f) {
  const row = (label, key, opts) => `<div class="frow"><span>${label}</span>${opts.map(([v, t]) =>
    `<button data-f="${key}" data-v="${v}" class="${(f[key] || '') === v ? 'on' : ''}">${t}</button>`).join('')}</div>`;
  return `<div class="filters">${row('出版年代', 'dec', DECADES)}${row('首次提及', 'first', FIRST)}</div>`;
}

// ---------- list views ----------
const VIEWS = {
  '/': {
    title: '今日书架', nav: '/',
    intro: (m) => `每天从 HN 读者提起过的 ${fmt(m.books)} 本书里，换一批端上来。想看硬排名，去<a href="/top" data-link>历史总榜</a>。`,
    rows: async (f) => {
      const filtered = f.dec || f.first;
      const pool = filtered ? applyFilters(await loadAll(), f).slice(0, 2500) : (await loadTop());
      const rnd = seeded(todaySeed());
      const arr = [...pool];
      for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
      return arr.slice(0, 120);
    },
  },
  '/top': {
    title: '历史总榜', nav: '/top', rank: true,
    intro: () => '按“有多少位不同的读者提起过”排序，2007 年至今。一个人反复提同一本书，只算一次。',
    rows: async (f) => applyFilters(await loadAll(), f),
  },
  '/recommended': {
    title: '最多推荐', nav: '/recommended', rank: true,
    intro: () => '提起不等于推荐。这里只数明确推荐过这本书的人数——有人提书是为了吐槽。',
    rows: async (f) => applyFilters(await loadAll(), f).filter((b) => b.e > 0).sort((a, b) => b.e - a.e),
  },
  '/rising': {
    title: '上升最快', nav: '/rising', rank: true,
    intro: () => '近一年被提起的次数，相对它往年平均水平涨得最多的书。',
    stat: (b) => `近一年 <b>${fmt(b.n1)}</b> 次 · 是往年的 ${b.rise} 倍`,
    rows: async (f) => applyFilters(await loadAll(), f).filter((b) => b.rise).sort((a, b) => b.rise - a.rise),
  },
  '/lindy': {
    title: '林迪榜', nav: '/lindy', rank: true,
    intro: () => '出版超过 50 年，最近一年仍然有人在聊。时间是最好的书评人。',
    stat: (b) => `${b.y} 年出版 · 近一年 <b>${fmt(b.n1)}</b> 次提及`,
    rows: async (f) => applyFilters(await loadAll(), f)
      .filter((b) => b.y && b.y <= THIS_YEAR - 50 && b.n1 > 0).sort((a, b) => b.n1 - a.n1 || b.p - a.p),
  },
  '/shelf': {
    title: '我的书架', nav: '/shelf', noFilter: true,
    intro: () => '你标记为“想读”的书，只保存在这台设备的浏览器里。',
    empty: '书架还空着。在书的详情页点“想读”，它就会出现在这里。',
    rows: async () => (await loadAll()).filter((b) => shelf.has(b.i)),
  },
};

async function listView(path, params) {
  const v = VIEWS[path];
  const f = { dec: params.get('dec') || '', first: params.get('first') || '' };
  const meta = await loadMeta();
  head(v.title, v.intro(meta), v.noFilter ? '' : filterBar(f));
  const rows = await v.rows(f);
  renderGrid(rows, { rank: v.rank, stat: v.stat, empty: v.empty });
  setNav(v.nav);
  document.title = `${v.title} · 黑客书架`;
}

async function topicView(slug, params) {
  const t = await loadTopics();
  const item = t.groups.flatMap((g) => g.items).find((x) => x.s === slug);
  const f = { dec: params.get('dec') || '', first: params.get('first') || '' };
  const name = item?.n || slug;
  head(name, `HN 读者提起过的 ${fmt(item?.c)} 本「${esc(name)}」类书，按提及人数排序。`, filterBar(f));
  renderGrid(applyFilters(await loadAll(), f).filter((b) => b.tp.includes(slug)), { rank: true });
  setNav('/topic/' + slug);
  document.title = `${name} · 黑客书架`;
}

async function searchView(q) {
  const qq = q.trim().toLowerCase();
  head(`搜索：${esc(q)}`, '');
  const all = await loadAll();
  const words = qq.split(/\s+/).filter(Boolean);
  const hits = !words.length ? [] : all.filter((b) => {
    const hay = (b.t + ' ' + (b.z || '') + ' ' + (b.a || []).join(' ')).toLowerCase();
    return words.every((w) => hay.includes(w));
  });
  $main.querySelector('.page-head p').textContent = hits.length ? `找到 ${fmt(hits.length)} 本` : '';
  renderGrid(hits, { empty: '没有找到。试试英文书名，或者只输入作者的姓。' });
  setNav('');
  document.title = `搜索 ${q} · 黑客书架`;
}

function head(title, intro, extra = '') {
  $main.innerHTML = `<header class="page-head"><h1>${title}</h1><p>${intro}</p>${extra}</header><div class="grid" id="grid"></div><div id="moreWrap"></div>${footer()}`;
}

function renderGrid(rows, opts = {}) {
  const grid = document.getElementById('grid');
  const wrap = document.getElementById('moreWrap');
  if (!rows.length) { grid.outerHTML = `<p class="empty">${opts.empty || '这里暂时没有书。'}</p>`; return; }
  let shown = 0;
  const more = () => {
    const next = rows.slice(shown, shown + PAGE);
    grid.insertAdjacentHTML('beforeend', next.map((b, k) => card(b, { rank: opts.rank ? shown + k + 1 : 0, stat: opts.stat })).join(''));
    shown += next.length;
    wrap.innerHTML = shown < rows.length ? `<button class="more">再看 ${Math.min(PAGE, rows.length - shown)} 本（共 ${fmt(rows.length)}）</button>` : '';
    wrap.querySelector('.more')?.addEventListener('click', more);
  };
  more();
}

const footer = () => `<footer class="foot">
  书目与排名来自 <a href="https://hackerbooks.org" target="_blank" rel="noopener">hackerbooks.org</a>（roansh 作品，公开数据）；
  书籍元数据与封面来自 <a href="https://openlibrary.org" target="_blank" rel="noopener">Open Library</a>；
  评论摘录经由 <a href="https://hn.algolia.com" target="_blank" rel="noopener">HN Search</a> 获取，版权归原作者，点击可回到原帖。<br>
  本站与 Y Combinator / Hacker News 无从属关系。 · <a href="/about" data-link>关于本站</a></footer>`;

// ---------- book detail ----------
async function bookView(id) {
  $main.innerHTML = '<div class="loading">正在翻开这本书…</div>';
  const all = await loadAll();
  const b = BYID.get(id);
  if (!b) { $main.innerHTML = `<p class="empty">没有找到这本书。<a href="/" data-link>回到书架</a></p>`; return; }
  const t = await loadTopics();
  const label = Object.fromEntries(t.groups.flatMap((g) => g.items).map((x) => [x.s, x.n]));
  const zh = b.z;
  const on = shelf.has(b.i);
  const q = encodeURIComponent(b.t);
  $main.innerHTML = `
    <a class="back" href="/" data-link onclick="if(history.length>1){history.back();return false}">← 黑客书架</a>
    <article class="book">
      ${cover(b, 'L')}
      <div>
        <h1>${esc(zh || b.t)}</h1>
        ${zh ? `<div class="en">${esc(b.t)}</div>` : ''}
        <div class="au">${esc(authors(b))}${b.y ? ` · 初版 ${b.y} 年` : ''}</div>
        ${b.w ? `<p class="w">${esc(b.w)}</p>` : ''}
        <div class="nums">
          <div><b class="ac">${fmt(b.e)}</b><span>人推荐</span></div>
          <div><b>${fmt(b.p)}</b><span>位读者提起</span></div>
          <div><b>${fmt(b.m)}</b><span>次提及</span></div>
          ${b.n1 != null ? `<div><b>${fmt(b.n1)}</b><span>近一年提及</span></div>` : ''}
          <div><b>#${fmt(b.r)}</b><span>总榜排名</span></div>
        </div>
        <div class="tags">${b.tp.map((s) => `<a href="/topic/${s}" data-link>${esc(label[s] || s)}</a>`).join('')}
          <a style="background:none;color:var(--mute)">HN 上被提起：${b.f}–${b.l}</a></div>
        <div class="links">
          <button class="btn ${on ? 'on' : ''}" id="shelfBtn"><svg viewBox="0 0 24 24" width="16" height="16"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg><span>${on ? '已在书架' : '想读'}</span></button>
          <a class="btn" href="https://search.douban.com/book/subject_search?search_text=${q}" target="_blank" rel="noopener">豆瓣</a>
          <a class="btn" href="https://openlibrary.org/works/${b.i}" target="_blank" rel="noopener">Open Library</a>
          <a class="btn" href="https://hn.algolia.com/?type=comment&query=${encodeURIComponent('"' + b.t.split(/[:;(]/)[0].trim() + '"')}" target="_blank" rel="noopener">在 HN 搜索</a>
        </div>
      </div>
    </article>
    <h2 class="section-title">HN 读者怎么说</h2>
    <p class="section-note">从提到这本书的评论里挑出的几段原话，点击日期可回到原帖。</p>
    <div class="quotes" id="quotes"><div class="loading">加载评论…</div></div>
    <h2 class="section-title">同类的书</h2>
    <div class="grid small" id="similar"></div>
    ${footer()}`;
  document.title = `${zh || b.t} · 黑客书架`;
  setNav('');
  document.getElementById('shelfBtn').addEventListener('click', (e) => {
    const now = toggleShelf(b.i);
    e.currentTarget.classList.toggle('on', now);
    e.currentTarget.querySelector('span').textContent = now ? '已在书架' : '想读';
  });
  const main = b.tp[0];
  const sim = all.filter((x) => x.i !== b.i && main && x.tp.includes(main) && Math.abs(x.r - b.r) < 4000).slice(0, 12);
  document.getElementById('similar').innerHTML = sim.map((x) => card(x, { small: true })).join('');

  const qs = document.getElementById('quotes');
  try {
    const shard = await json(`/data/b/${fnv(b.i)}.json`);
    const cs = shard[b.i]?.hn?.c || [];
    qs.innerHTML = cs.length ? cs.map((c) => `<blockquote class="quote">${c.x.split(/\n\s*\n+/).map((para) => `<p>${esc(para.trim())}</p>`).join('')}<footer>
      <span>${esc(c.by)}</span>
      <a href="https://news.ycombinator.com/item?id=${c.id}" target="_blank" rel="noopener">${new Date(c.t * 1000).toISOString().slice(0, 10)}</a>
      ${c.st ? `<a href="https://news.ycombinator.com/item?id=${c.sid}" target="_blank" rel="noopener">在「${esc(c.st)}」中</a>` : ''}
    </footer></blockquote>`).join('') : '<p class="empty">评论摘录还在整理中。</p>';
  } catch {
    qs.innerHTML = '<p class="empty">评论摘录还在整理中。</p>';
  }
}

async function aboutView() {
  const m = await loadMeta();
  $main.innerHTML = `<article class="prose">
    <h1>关于黑客书架</h1>
    <p>Hacker News 的评论区里，常有人顺手推荐一本改变了自己的书。黑客书架把 2007 年以来这些被提起的书整理在一起：目前收录 ${fmt(m.books)} 本，共 ${fmt(m.mentions)} 次提及。</p>
    <h2>排名怎么算</h2>
    <p>主要看“有多少位不同的读者提起过”，而不是总提及次数，这样一个人反复安利同一本书不会把它刷上去。“最多推荐”只数明确推荐的人，“上升最快”比较的是近一年与往年平均。</p>
    <h2>数据从哪来</h2>
    <p>书目、提及与推荐人数来自 <a href="https://hackerbooks.org/about" target="_blank" rel="noopener">hackerbooks.org</a>（roansh 作品）公开发布的数据集；书籍元数据与封面来自 <a href="https://openlibrary.org" target="_blank" rel="noopener">Open Library</a>；评论摘录与近一年提及数来自 <a href="https://hn.algolia.com/api" target="_blank" rel="noopener">HN Search API</a>，版权归评论作者，每段都链接回原帖。数据每周自动更新，最近一次：${m.generated}。</p>
    <h2>隐私</h2>
    <p>没有账号。“我的书架”只保存在你自己的浏览器里。</p>
    <h2>键盘快捷键</h2>
    <p>按 <kbd>?</kbd> 查看。</p>
    <p style="margin-top:32px;color:var(--mute)">本站与 Y Combinator / Hacker News 无从属关系。</p>
  </article>`;
  setNav('/about');
  document.title = '关于本站 · 黑客书架';
}

// ---------- sidebar ----------
async function renderTopicNav() {
  const t = await loadTopics();
  document.getElementById('topicNav').innerHTML = t.groups.map((g) => `<h4>${esc(g.name)}</h4>` +
    g.items.map((x) => `<a href="/topic/${x.s}" data-link data-nav="/topic/${x.s}">${esc(x.n)}<small>${fmt(x.c)}</small></a>`).join('')).join('');
  setNav(currentNav);
}
let currentNav = '';
function setNav(p) {
  currentNav = p;
  document.querySelectorAll('.nav a, .topic-nav a').forEach((a) => a.classList.toggle('on', (a.dataset.nav || a.getAttribute('href')) === p));
}

// ---------- router ----------
async function route() {
  const url = new URL(location.href);
  const p = url.pathname.replace(/\/+$/, '') || '/';
  document.body.classList.remove('nav-open');
  kbIndex = -1;
  try {
    if (VIEWS[p]) await listView(p, url.searchParams);
    else if (p.startsWith('/topic/')) await topicView(decodeURIComponent(p.slice(7)), url.searchParams);
    else if (p.startsWith('/b/')) await bookView(decodeURIComponent(p.slice(3)));
    else if (p === '/search') { document.getElementById('q').value = url.searchParams.get('q') || ''; await searchView(url.searchParams.get('q') || ''); }
    else if (p === '/about') await aboutView();
    else $main.innerHTML = '<p class="empty">这一页不在书架上。<a href="/" data-link>回到首页</a></p>';
  } catch (e) {
    console.error(e);
    $main.innerHTML = '<p class="empty">加载失败了，刷新一下试试。</p>';
  }
}
function go(href, replace = false) {
  history[replace ? 'replaceState' : 'pushState']({}, '', href);
  route().then(() => { if (!replace) window.scrollTo(0, 0); });
}

document.addEventListener('click', (e) => {
  const fb = e.target.closest('button[data-f]');
  if (fb) {
    const url = new URL(location.href);
    fb.dataset.v ? url.searchParams.set(fb.dataset.f, fb.dataset.v) : url.searchParams.delete(fb.dataset.f);
    go(url.pathname + url.search, true);
    return;
  }
  const a = e.target.closest('a[data-link]');
  if (a && !e.metaKey && !e.ctrlKey && !e.shiftKey && e.button === 0) {
    e.preventDefault();
    go(a.getAttribute('href'));
  }
});
window.addEventListener('popstate', route);

document.getElementById('searchForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = document.getElementById('q').value.trim();
  if (q) go('/search?q=' + encodeURIComponent(q));
});
let searchTimer;
document.getElementById('q').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  const q = e.target.value.trim();
  if (q.length < 2) return;
  searchTimer = setTimeout(() => go('/search?q=' + encodeURIComponent(q), location.pathname === '/search'), 300);
});

// menu & theme
const menuBtn = document.getElementById('menuBtn');
menuBtn.addEventListener('click', () => { const o = document.body.classList.toggle('nav-open'); menuBtn.setAttribute('aria-expanded', o); });
document.getElementById('scrim').addEventListener('click', () => document.body.classList.remove('nav-open'));
// theme: light (米白) / blue (淡蓝) / dark (深色) / auto (跟随系统)
const themeBtn = document.getElementById('themeBtn');
const themeMenu = document.getElementById('themeMenu');
const THEME_COLOR = { light: '#faf8f4', blue: '#f2f7fc', dark: '#1b1a18' };
function applyTheme(t) {
  const root = document.documentElement;
  if (t === 'auto') delete root.dataset.theme; else root.dataset.theme = t;
  try { t === 'auto' ? localStorage.removeItem('hb.theme') : localStorage.setItem('hb.theme', t); } catch {}
  const eff = t === 'auto' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : t;
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', THEME_COLOR[eff]));
  themeMenu.querySelectorAll('[data-theme-set]').forEach((b) => b.setAttribute('aria-checked', b.dataset.themeSet === t));
}
function closeThemeMenu() { themeMenu.hidden = true; themeBtn.setAttribute('aria-expanded', 'false'); }
themeBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  themeMenu.hidden = !themeMenu.hidden;
  themeBtn.setAttribute('aria-expanded', String(!themeMenu.hidden));
  if (!themeMenu.hidden) themeMenu.querySelector('[aria-checked="true"]')?.focus();
});
themeMenu.addEventListener('click', (e) => {
  const b = e.target.closest('[data-theme-set]');
  if (b) { applyTheme(b.dataset.themeSet); closeThemeMenu(); themeBtn.focus(); }
});
document.addEventListener('click', (e) => { if (!themeMenu.hidden && !e.target.closest('.theme-wrap')) closeThemeMenu(); });
applyTheme(document.documentElement.dataset.theme || 'auto');

// keyboard
let kbIndex = -1, gPending = false;
const HELP = `<dialog id="help"><h3>键盘快捷键</h3><dl>
  <dt><kbd>/</kbd></dt><dd>聚焦搜索框</dd><dt><kbd>j</kbd> <kbd>k</kbd></dt><dd>下一本 / 上一本</dd>
  <dt><kbd>Enter</kbd></dt><dd>打开选中的书</dd><dt><kbd>Esc</kbd></dt><dd>关闭 / 返回</dd>
  <dt><kbd>g</kbd> <kbd>h</kbd></dt><dd>今日书架</dd><dt><kbd>g</kbd> <kbd>t</kbd></dt><dd>历史总榜</dd>
  <dt><kbd>g</kbd> <kbd>r</kbd></dt><dd>上升最快</dd><dt><kbd>g</kbd> <kbd>s</kbd></dt><dd>我的书架</dd>
  <dt><kbd>?</kbd></dt><dd>显示本帮助</dd></dl></dialog>`;
document.body.insertAdjacentHTML('beforeend', HELP);
document.addEventListener('keydown', (e) => {
  const inField = /INPUT|TEXTAREA/.test(document.activeElement?.tagName);
  if (e.key === 'Escape') {
    if (inField) { document.activeElement.blur(); return; }
    if (!themeMenu.hidden) { closeThemeMenu(); themeBtn.focus(); return; }
    if (document.body.classList.contains('nav-open')) { document.body.classList.remove('nav-open'); return; }
    if (location.pathname.startsWith('/b/')) history.back();
    return;
  }
  if (inField || e.metaKey || e.ctrlKey || e.altKey) return;
  if (gPending) {
    gPending = false;
    const to = { h: '/', t: '/top', r: '/rising', s: '/shelf', m: '/recommended' }[e.key];
    if (to) go(to);
    return;
  }
  if (e.key === '/') { e.preventDefault(); document.getElementById('q').focus(); }
  else if (e.key === '?') document.getElementById('help').showModal();
  else if (e.key === 'g') gPending = true;
  else if (e.key === 'j' || e.key === 'k') {
    const cards = [...document.querySelectorAll('#grid .card')];
    if (!cards.length) return;
    cards[kbIndex]?.classList.remove('kb');
    kbIndex = Math.max(0, Math.min(cards.length - 1, kbIndex + (e.key === 'j' ? 1 : -1)));
    cards[kbIndex].classList.add('kb');
    cards[kbIndex].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  } else if (e.key === 'Enter' && kbIndex >= 0) {
    document.querySelectorAll('#grid .card')[kbIndex]?.click();
  }
});

renderTopicNav();
route();
loadAll(); // warm the full index in the background
