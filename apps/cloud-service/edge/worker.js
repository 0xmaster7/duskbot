// The public front of managed cloud desktops: https://<label>.<DUSK_MANAGED_PUBLIC_DOMAIN> -> the machine's own hosted
// URL at the provider. The client only ever sees our domain. The label is opaque (it names no person, cloud id or
// provider); the account service answers which upstream it maps to, for this Worker only (EDGE_TOKEN).
//
// Bindings: ROUTE_URL (the account service origin), EDGE_TOKEN (secret, same value as its DUSK_MANAGED_EDGE_TOKEN),
// PUBLIC_DOMAIN (the wildcard's parent, e.g. desktops.example.com). Route: *.<PUBLIC_DOMAIN>/*.
const LABEL = /^d[0-9a-f]{20}$/;
const ROUTE_TTL_S = 60;

async function upstreamFor(label, env, ctx) {
  const cache = caches.default, key = new Request(`https://route.cache/${label}`);
  const hit = await cache.match(key);
  if (hit) return (await hit.json()).upstream;
  const answer = await fetch(`${env.ROUTE_URL}/v1/managed/edge/route?label=${label}`, { headers: { authorization: `Bearer ${env.EDGE_TOKEN}` } });
  if (answer.status === 404) return null;
  if (!answer.ok) throw new Error("route lookup failed");
  const body = await answer.json();
  if (typeof body.upstream !== "string" || !body.upstream.startsWith("https://")) return null;
  ctx.waitUntil(cache.put(key, new Response(JSON.stringify({ upstream: body.upstream }), { headers: { "cache-control": `max-age=${ROUTE_TTL_S}` } })));
  return body.upstream;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const label = url.hostname.endsWith(`.${env.PUBLIC_DOMAIN}`) ? url.hostname.slice(0, -env.PUBLIC_DOMAIN.length - 1) : "";
    if (!LABEL.test(label)) return new Response("Not found", { status: 404 });
    let upstream;
    try { upstream = await upstreamFor(label, env, ctx); } catch { return new Response("Unavailable", { status: 503, headers: { "retry-after": "5" } }); }
    if (!upstream) return new Response("Not found", { status: 404 });
    const target = new URL(url.pathname + url.search, upstream);
    const headers = new Headers(request.headers);
    // the machine answers only for its own names and keeps its own idea of the public origin (DUSK_PUBLIC_URL)
    headers.set("x-forwarded-host", url.hostname);
    const response = await fetch(new Request(target, { method: request.method, headers, body: request.body, redirect: "manual" }));
    if (response.status === 101) return response;
    const out = new Response(response.body, response);
    for (const name of ["server", "via", "x-powered-by"]) out.headers.delete(name);
    const location = out.headers.get("location");
    if (location?.startsWith(upstream)) out.headers.set("location", `https://${url.hostname}${location.slice(upstream.length)}`);
    return out;
  },
};
