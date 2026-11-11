// What the Worker and its hook queue both ask the account service, and how either one reaches a home.
export const LABEL = /^d[0-9a-f]{20}$/;
/** a home answering with one of these is not up (yet), whatever the route says */
export const DOWN = [502, 503, 504, 521, 522, 523];

/** the account service's answer for a label, never cached: null when it maps to no home */
export async function lookupRoute(label, env) {
  const answer = await fetch(`${env.ROUTE_URL}/v1/managed/edge/route?label=${label}`, { headers: { authorization: `Bearer ${env.EDGE_TOKEN}` } });
  if (answer.status === 404) return null;
  if (!answer.ok) throw new Error("route lookup failed");
  const body = await answer.json();
  if (typeof body.upstream !== "string" || !body.upstream.startsWith("https://")) return null;
  return { upstream: body.upstream, awake: body.awake !== false, wakeable: body.wakeable === true };
}

/** asks the service to wake a home: 200 awake, 202 waking, 429 over its hourly cap, 409 not wakeable, 503 unreachable */
export async function askWake(label, reason, env) {
  const asked = await fetch(`${env.ROUTE_URL}/v1/managed/edge/wake?label=${label}&reason=${reason}`, { method: "POST", headers: { authorization: `Bearer ${env.EDGE_TOKEN}`, "content-type": "application/json" }, body: "{}" }).catch(() => null);
  await asked?.body?.cancel().catch(() => {});
  if (!asked) return 503;
  if (asked.status === 429 || asked.status === 409) return asked.status;
  return asked.ok ? asked.status : 503;
}

/** a request to the home as the client sent it, under the public name the home keeps (DUSK_PUBLIC_URL) */
export function upstreamRequest(upstream, host, { method, path, headers, body }) {
  const sent = new Headers(headers);
  sent.set("x-forwarded-host", host);
  const init = { method, headers: sent, redirect: "manual" };
  if (body !== undefined && body !== null) init.body = body;
  return new Request(new URL(path, upstream), init);
}
