// GET /cover/<openlibrary-cover-id>-<S|M|L>.jpg
// Proxies Open Library covers through Cloudflare's edge cache. Open Library
// often redirects to archive.org, which is unreachable from mainland China.
const OK = /^(\d{1,10})-([SML])\.jpg$/;
const MONTH = 60 * 60 * 24 * 30;

export async function onRequestGet({ params, request, waitUntil }) {
  const m = OK.exec(params.name || '');
  if (!m) return new Response('Not found', { status: 404 });

  const cache = caches.default;
  const key = new Request(new URL(request.url).origin + `/cover/${m[1]}-${m[2]}.jpg`);
  const hit = await cache.match(key);
  if (hit) return hit;

  const upstream = await fetch(`https://covers.openlibrary.org/b/id/${m[1]}-${m[2]}.jpg`, {
    redirect: 'follow',
    cf: { cacheTtl: MONTH, cacheEverything: true },
  });
  const type = upstream.headers.get('content-type') || '';
  if (!upstream.ok || !type.startsWith('image/')) {
    return new Response('Cover unavailable', { status: 404, headers: { 'Cache-Control': 'public, max-age=86400' } });
  }
  const res = new Response(upstream.body, {
    headers: {
      'Content-Type': type,
      'Cache-Control': `public, max-age=${MONTH * 12}, immutable`,
      'Access-Control-Allow-Origin': '*',
    },
  });
  waitUntil(cache.put(key, res.clone()));
  return res;
}
