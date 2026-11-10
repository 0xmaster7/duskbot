// The public front of managed cloud desktops: https://<label>.<DUSK_MANAGED_PUBLIC_DOMAIN> -> the machine's own hosted
// URL at the provider. The client only ever sees our domain. The label is opaque (it names no person, cloud id or
// provider); the account service answers which upstream it maps to and whether that home is awake, for this Worker only.
// A sleeping home is woken for a webhook (/hooks/*) or a client that carries credentials (the app, a signed-in
// browser), and the request is held until the home answers; anonymous traffic never wakes one. The service caps the
// wakes per home per hour, since each is a provider start.
//
// Bindings: ROUTE_URL (the account service origin), EDGE_TOKEN (secret, same value as its DUSK_MANAGED_EDGE_TOKEN),
// PUBLIC_DOMAIN (the wildcard's parent, e.g. desktops.example.com). Route: *.<PUBLIC_DOMAIN>/*.
const LABEL = /^d[0-9a-f]{20}$/;
const ROUTE_TTL_S = 60;
/** a held request waits this long for a waking home; webhook senders time out not much later */
export const HOLD_MS = 25_000;
const MAX_HELD_BODY = 2 * 1024 * 1024;

function cacheKey(label) { return new Request(`https://route.cache/${label}`); }

export async function routeFor(label, env, ctx, { fresh = false } = {}) {
  const cache = globalThis.caches?.default, key = cacheKey(label);
  if (!fresh && cache) {
    const hit = await cache.match(key);
    if (hit) return { ...(await hit.json()), awake: true };
  }
  const answer = await fetch(`${env.ROUTE_URL}/v1/managed/edge/route?label=${label}`, { headers: { authorization: `Bearer ${env.EDGE_TOKEN}` } });
  if (answer.status === 404) return null;
  if (!answer.ok) throw new Error("route lookup failed");
  const body = await answer.json();
  if (typeof body.upstream !== "string" || !body.upstream.startsWith("https://")) return null;
  const route = { upstream: body.upstream, awake: body.awake !== false, wakeable: body.wakeable === true };
  // only an awake home's route is cached: a sleeping one is asked again until it answers
  if (route.awake && cache) ctx.waitUntil(cache.put(key, new Response(JSON.stringify({ upstream: route.upstream }), { headers: { "cache-control": `max-age=${ROUTE_TTL_S}` } })));
  return route;
}

/** a request a sleeping home is woken for: a webhook, or a client that carries a credential */
export function wakeReason(request, url) {
  if (url.pathname.startsWith("/hooks/")) return "webhook";
  if (request.headers.has("authorization") || request.headers.has("cookie")) return "client";
  if ((request.headers.get("upgrade") ?? "").toLowerCase() === "websocket" && url.searchParams.has("token")) return "client";
  return null;
}

const sleepFor = ms => new Promise(resolve => setTimeout(resolve, ms));

async function wakeAndWait(label, reason, env, ctx, now = () => Date.now()) {
  const asked = await fetch(`${env.ROUTE_URL}/v1/managed/edge/wake?label=${label}&reason=${reason}`, { method: "POST", headers: { authorization: `Bearer ${env.EDGE_TOKEN}` } });
  if (asked.status === 429) return { status: 429 };
  if (!asked.ok) return { status: 503 };
  const deadline = now() + HOLD_MS;
  while (now() < deadline) {
    await sleepFor(1_000);
    const route = await routeFor(label, env, ctx, { fresh: true }).catch(() => null);
    if (route?.awake) return { status: 200, route };
  }
  return { status: 503 };
}

function waking(status) {
  const text = status === 429 ? "This Dusk Bot was woken too often this hour. Try again later." : "This Dusk Bot is waking up. Try again in a few seconds.";
  return new Response(text, { status: status === 429 ? 429 : 503, headers: { "content-type": "text/plain; charset=utf-8", "retry-after": status === 429 ? "300" : "5", "cache-control": "no-store" } });
}

async function forward(request, url, upstream, body) {
  const target = new URL(url.pathname + url.search, upstream);
  const headers = new Headers(request.headers);
  // the machine answers only for its own names and keeps its own idea of the public origin (DUSK_PUBLIC_URL)
  headers.set("x-forwarded-host", url.hostname);
  const init = { method: request.method, headers, redirect: "manual" };
  if (body !== undefined) init.body = body;
  else if (request.body) init.body = request.body;
  const response = await fetch(new Request(target, init));
  if (response.status === 101) return response;
  const out = new Response(response.body, response);
  for (const name of ["server", "via", "x-powered-by"]) out.headers.delete(name);
  const location = out.headers.get("location");
  if (location?.startsWith(upstream)) out.headers.set("location", `https://${url.hostname}${location.slice(upstream.length)}`);
  return out;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const label = url.hostname.endsWith(`.${env.PUBLIC_DOMAIN}`) ? url.hostname.slice(0, -env.PUBLIC_DOMAIN.length - 1) : "";
    if (!LABEL.test(label)) return new Response("Not found", { status: 404 });
    let route;
    try { route = await routeFor(label, env, ctx); } catch { return new Response("Unavailable", { status: 503, headers: { "retry-after": "5" } }); }
    if (!route) return new Response("Not found", { status: 404 });
    const reason = wakeReason(request, url);
    // a webhook's body is read first, so it can still reach the home after a wake, exactly as it was sent
    let body;
    if (request.body && reason === "webhook") {
      const buffer = await request.arrayBuffer();
      if (buffer.byteLength > MAX_HELD_BODY) return new Response("Too large", { status: 413 });
      body = buffer;
    }
    if (route.awake) {
      const response = await forward(request, url, route.upstream, body).catch(() => null);
      if (response && ![502, 503, 504, 521, 522, 523].includes(response.status)) return response;
      // a cached route can outlive the home's sleep: ask again, and wake it if it sleeps
      ctx.waitUntil(globalThis.caches?.default?.delete(cacheKey(label)) ?? Promise.resolve());
      if (request.body && body === undefined) return response ?? waking(503);
      route = await routeFor(label, env, ctx, { fresh: true }).catch(() => null);
      if (!route || route.awake) return response ?? waking(503);
    }
    if (!reason || !route.wakeable) return waking(503);
    if (request.body && body === undefined) {
      const buffer = await request.arrayBuffer();
      if (buffer.byteLength > MAX_HELD_BODY) return new Response("Too large", { status: 413 });
      body = buffer;
    }
    const woke = await wakeAndWait(label, reason, env, ctx);
    if (woke.status !== 200) return waking(woke.status);
    return forward(request, url, woke.route.upstream, body);
  },
};
