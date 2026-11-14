// Settings follow the person: every place of their own (this computer, My Cloud, servers of their own) has the same
// settings, the app's own preferences and the person's keys among them. Each pass reads every place's settings
// (server/settings-sync.ts, digests and times only) and brings them level, setting by setting:
//
//   the last change wins, wherever it was made; the place that has it hands its value to every place that differs
//   a setting nobody has changed since its place first saw it: a place where it is set beats one where it is not,
//   then this computer, then My Cloud, then a server (so a new place takes the person's settings, never the reverse)
//   a setting one place does not list (an address only it reaches, or a server too old to know it) is left alone there
//
// Secrets travel only between this app's main process and the person's own places: this computer's over its private
// port, a Cloud's or a server's over this window's own sign-in there. Nothing here logs a value.
//
//   const result = await syncSettings(places);
//
// `places`: [{ key, kind: "local" | "cloud" | "sleeping-cloud" | "server", label, client }], `client` from
// localSettingsPlace or remoteSettingsPlace.

const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const RANK = { local: 0, cloud: 1, "sleeping-cloud": 1, server: 2 };
const KEY = /^[\w.:-]{1,160}$/u;
const DIGEST = /^[0-9a-f]{64}$/u;
/** A setting a place would not take is not offered to it again, with the same value, for this long. */
export const REFUSED_MS = 30 * 60_000;

/** A place's GET /api/settings-sync, kept to its known shape; null when it is not one. */
export function parseSettingsListing(value) {
  if (!record(value) || !record(value.place) || typeof value.place.id !== "string" || !record(value.settings)) return null;
  const settings = {};
  for (const [key, entry] of Object.entries(value.settings)) {
    if (!KEY.test(key) || !record(entry) || typeof entry.digest !== "string" || !DIGEST.test(entry.digest) || !Number.isFinite(entry.at)) continue;
    settings[key] = { digest: entry.digest, at: entry.at, kind: entry.kind === "secret" ? "secret" : "plain", set: entry.set === true };
  }
  return { place: { id: value.place.id, label: typeof value.place.label === "string" ? value.place.label : "" }, settings };
}

async function answer(response) {
  const text = await response.text().catch(() => "");
  try { return { ok: response.ok, status: response.status, body: text ? JSON.parse(text) : null }; }
  catch { return { ok: response.ok, status: response.status, body: null }; }
}

function must(result, what) {
  if (!result.ok) throw Object.assign(new Error(`${what} answered ${result.status}`), { status: result.status });
  return result.body ?? {};
}

/** A Cloud or a server of the person's own, over this window's own sign-in there: `call(method, route, body?)`. */
export function remoteSettingsPlace(call) {
  return {
    list: async () => parseSettingsListing(must(await call("GET", "/api/settings-sync"), "list")),
    values: async (keys) => must(await call("POST", "/api/settings-sync/values", { keys }), "values").values ?? {},
    put: async (key, value, at) => must(await call("PUT", "/api/settings-sync/values", { key, value, at }), "put"),
  };
}

/**
 * This computer: everything over loopback (`request(route, init)` answering a Response) but the values of secrets,
 * which come over the private port (`handoff`). `saveSecret(key, value)`: this app's own way of keeping a key it keeps
 * encrypted, true when it kept it (the time it changed is then marked here).
 */
export function localSettingsPlace(request, handoff, { saveSecret } = {}) {
  const call = async (method, route, body) => answer(await request(route, {
    method, signal: AbortSignal.timeout(30_000),
    ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  }));
  let secretKeys = new Set();
  return {
    list: async () => {
      const listing = parseSettingsListing(must(await call("GET", "/api/settings-sync"), "list"));
      if (listing) secretKeys = new Set(Object.entries(listing.settings).filter(([, entry]) => entry.kind === "secret").map(([key]) => key));
      return listing;
    },
    values: async (keys) => {
      const secret = keys.filter((key) => secretKeys.has(key)), plain = keys.filter((key) => !secretKeys.has(key));
      const out = plain.length ? { ...(must(await call("POST", "/api/settings-sync/values", { keys: plain }), "values").values ?? {}) } : {};
      if (secret.length) {
        const got = await handoff({ kind: "settings", op: "values", keys: secret });
        if (!record(got?.settings?.values)) throw new Error("this computer did not answer");
        Object.assign(out, got.settings.values);
      }
      return out;
    },
    put: async (key, value, at) => {
      if (secretKeys.has(key) && saveSecret && await saveSecret(key, value)) return must(await call("POST", "/api/settings-sync/stamp", { key, at }), "stamp");
      return must(await call("PUT", "/api/settings-sync/values", { key, value, at }), "put");
    },
  };
}

/**
 * One pass over the person's places. Each step that fails is skipped and tried again next pass (or, refused, after
 * REFUSED_MS); the others go on. `refused`: a Map kept between passes. Returns { changed: [{ key, place }], failed }.
 */
export async function syncSettings(places, { now = Date.now, log = () => {}, refused = new Map() } = {}) {
  const result = { changed: [], failed: [] };
  const views = [];
  for (const place of places) {
    const listing = await place.client.list().catch(() => null);
    if (listing) views.push({ ...place, rank: RANK[place.kind] ?? 3, listing });
  }
  if (views.length < 2) return result;
  for (const [mark, until] of refused) if (until <= now()) refused.delete(mark);

  // what each place should take, from which place
  const plan = [];
  const keys = new Set(views.flatMap((view) => Object.keys(view.listing.settings)));
  for (const key of keys) {
    const have = views.filter((view) => view.listing.settings[key]);
    if (have.length < 2) continue;
    const entry = (view) => view.listing.settings[key];
    if (have.every((view) => entry(view).digest === entry(have[0]).digest)) continue;
    const source = have.reduce((best, view) => {
      const a = entry(view), b = entry(best);
      if (a.at !== b.at) return a.at > b.at ? view : best;
      if (a.at === 0 && a.set !== b.set) return a.set ? view : best;
      return view.rank < best.rank ? view : best;
    });
    for (const view of have) {
      if (view === source || entry(view).digest === entry(source).digest) continue;
      const mark = `${view.key}|${key}|${entry(source).digest}`;
      if (refused.has(mark)) continue;
      plan.push({ key, source, target: view, at: entry(source).at, mark });
    }
  }
  if (!plan.length) return result;

  const values = new Map();
  for (const source of new Set(plan.map((step) => step.source))) {
    const wanted = [...new Set(plan.filter((step) => step.source === source).map((step) => step.key))];
    try { values.set(source, await source.client.values(wanted)); } catch (error) {
      result.failed.push(`read settings at ${source.label}`);
      log(`settings sync: reading ${source.label} failed${error?.status ? ` (${error.status})` : ""}`);
    }
  }
  for (const step of plan) {
    const from = values.get(step.source);
    if (!from || !Object.hasOwn(from, step.key)) continue;
    try {
      await step.target.client.put(step.key, from[step.key], step.at);
      result.changed.push({ key: step.key, place: step.target.label });
    } catch (error) {
      result.failed.push(`${step.key} at ${step.target.label}`);
      // a place that refuses a value (an engine it lacks, a key its provider turns down) is not asked again soon
      if (error?.status >= 400 && error.status < 500 && error.status !== 409) refused.set(step.mark, now() + REFUSED_MS);
      log(`settings sync: ${step.key} at ${step.target.label} failed${error?.status ? ` (${error.status})` : ""}`);
    }
  }
  return result;
}
