// Connectors follow the person: every place of their own (this computer, My Cloud, servers of their own) has the same
// MCP servers reached by address, Composio Connect among them, signed in the same. Each pass reads every place's
// connectors (server/connector-sync.ts, names and digests only) and brings them level:
//
//   servers    one added in a place is added in the others; one removed is removed everywhere (the later wins)
//   settings   an app's own settings (on or off, its apps in chat, its address, its account) as last changed anywhere
//   sign-outs  a sign-out in one place ends that sign-in in every place
//   holder     one place keeps a sign-in's refresh token, which may rotate: My Cloud before a server before this
//              computer, so a sign-in made here moves to a place that is always on (as a move does). A Cloud on a plan
//              that sleeps comes after this computer: nothing here wakes it, so it could not lend while asleep
//   lent       every other place uses the holder's access token, topped up before it runs out
//
// Secrets travel only between this app's main process and the person's own places: this computer's over its private
// port, a Cloud's or a server's over this window's own sign-in there. Nothing here logs one.
//
//   const result = await syncConnectors(places);
//
// `places`: [{ key, kind: "local" | "cloud" | "sleeping-cloud" | "server", label, client }], `client` from localPlace or remotePlace.

const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const RANK = { cloud: 0, server: 1, local: 2, "sleeping-cloud": 3 };
/** A lent token with less than this left is topped up; the holder lends one with at least 15 minutes left. */
export const TOPUP_MS = 10 * 60_000;
const NAME = /^[a-z][a-z0-9_-]{0,31}$/u;
const DIGEST = /^[0-9a-f]{64}$/u;

/** A place's GET /api/connector-sync, kept to its known shape; null when it is not one. */
export function parseListing(value) {
  if (!record(value) || !Array.isArray(value.servers) || !record(value.place) || typeof value.place.id !== "string") return null;
  const times = (map) => Object.fromEntries(Object.entries(record(map) ? map : {}).filter(([url, at]) => typeof url === "string" && Number.isFinite(at)));
  const servers = value.servers.filter((s) => record(s) && typeof s.name === "string" && NAME.test(s.name) && typeof s.url === "string" && record(s.signIn)).map((s) => ({
    name: s.name, url: s.url, enabled: s.enabled === true, addedAt: Number.isFinite(s.addedAt) ? s.addedAt : 0,
    editedAt: Number.isFinite(s.editedAt) ? s.editedAt : 0, settings: typeof s.settings === "string" && DIGEST.test(s.settings) ? s.settings : "",
    signIn: {
      role: ["holder", "lent", "needs-sign-in", "none"].includes(s.signIn.role) ? s.signIn.role : "none",
      ...(typeof s.signIn.digest === "string" && DIGEST.test(s.signIn.digest) ? { digest: s.signIn.digest } : {}),
      ...(Number.isFinite(s.signIn.expiresAt) ? { expiresAt: s.signIn.expiresAt } : {}),
      ...(Number.isFinite(s.signIn.signedInAt) ? { signedInAt: s.signIn.signedInAt } : {}),
    },
  }));
  return { place: { id: value.place.id, label: typeof value.place.label === "string" ? value.place.label : "" }, servers, removed: times(value.removed), signedOut: times(value.signedOut) };
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

const enc = encodeURIComponent;

/** The writes every place takes the same way: over HTTP, `call(method, route, body?)` answering { ok, status, body }. */
export function writes(call) {
  const route = (name, rest = "") => `/api/connector-sync/servers/${enc(name)}${rest}`;
  return {
    list: async () => parseListing(must(await call("GET", "/api/connector-sync"), "list")),
    put: async (name, server, addedAt, editedAt = 0) => must(await call("PUT", route(name), { server, addedAt, ...(editedAt > 0 ? { editedAt } : {}) }), "put"),
    remove: async (name, at) => must(await call("DELETE", route(name, `?at=${at}`)), "remove"),
    signOut: async (name, at) => must(await call("POST", route(name, "/sign-out"), { at }), "sign-out"),
    borrow: async (name, lent) => must(await call("PUT", route(name, "/lent"), lent), "lent"),
    adopt: async (name, taken, replaces) => must(await call("PUT", route(name, `/sign-in${replaces ? `?replaces=${replaces}` : ""}`), taken), "sign-in"),
  };
}

/** A Cloud or a server of the person's own, over this window's own sign-in there. */
export function remotePlace(call) {
  const route = (name, rest) => `/api/connector-sync/servers/${enc(name)}${rest}`;
  return {
    ...writes(call),
    definition: async (name) => must(await call("GET", route(name, "/definition")), "definition"),
    lend: async (name) => must(await call("POST", route(name, "/lend"), {}), "lend"),
    take: async (name) => must(await call("POST", route(name, "/take"), {}), "take"),
    release: async (name, digest, to) => must(await call("POST", route(name, "/release"), { digest, to }), "release"),
  };
}

/** This computer: writes over loopback (`request(route, init)` answering a Response), secrets over the private port. */
export function localPlace(request, handoff) {
  const call = async (method, route, body) => answer(await request(route, {
    method, signal: AbortSignal.timeout(20_000),
    ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  }));
  const ask = async (what) => {
    const got = await handoff({ kind: "connector", ...what });
    if (!record(got?.connector)) throw new Error("this computer did not answer");
    return got.connector;
  };
  return {
    ...writes(call),
    definition: (name) => ask({ op: "definition", name }),
    lend: (name) => ask({ op: "lend", name }),
    take: (name) => ask({ op: "take", name }),
    release: (name, digest, to) => ask({ op: "release", name, digest, to }),
  };
}

const latest = (values) => values.reduce((max, value) => (Number.isFinite(value) && value > max ? value : max), 0);

/**
 * One pass over the person's places. Each step that fails is skipped and tried again next pass; the others go on.
 * Returns what changed: { added, removed, edited, signedOut, moved, lent, failed }.
 */
export async function syncConnectors(places, { now = Date.now, log = () => {} } = {}) {
  const result = { added: [], removed: [], edited: [], signedOut: [], moved: [], lent: [], failed: [] };
  const views = [];
  for (const place of places) {
    const listing = await place.client.list().catch(() => null);
    if (listing) views.push({ ...place, rank: RANK[place.kind] ?? 3, listing });
  }
  if (views.length < 2) return result;
  const step = async (what, run) => {
    try { return await run(); } catch (error) {
      result.failed.push(what);
      log(`connector sync: ${what} failed${error?.status ? ` (${error.status})` : ""}`);
      return null;
    }
  };
  const serverAt = (view, url) => view.listing.servers.find((server) => server.url === url);
  const urls = new Set(views.flatMap((view) => [...view.listing.servers.map((server) => server.url), ...Object.keys(view.listing.removed)]));

  for (const url of urls) {
    let have = views.filter((view) => serverAt(view, url));
    const addAt = latest(have.map((view) => serverAt(view, url).addedAt));
    const removeAt = latest(views.map((view) => view.listing.removed[url]));
    if (removeAt > addAt) {
      for (const view of have) {
        const { name } = serverAt(view, url);
        if (await step(`remove ${name} at ${view.label}`, () => view.client.remove(name, removeAt))) result.removed.push({ name, place: view.label });
      }
      continue;
    }
    if (!have.length) continue;

    // the server, everywhere: as the place that changed it last has it
    const source = have.reduce((best, view) => (serverAt(view, url).addedAt > serverAt(best, url).addedAt ? view : best));
    const name = serverAt(source, url).name;
    let definition = null;
    for (const view of views.filter((v) => !serverAt(v, url))) {
      if (view.listing.servers.some((server) => server.name === name)) { result.failed.push(`${name} at ${view.label}: another server has this name`); continue; }
      definition ??= await step(`read ${name} at ${source.label}`, () => source.client.definition(name));
      if (!record(definition?.server)) break;
      const editedAt = Number(definition.editedAt) || 0;
      const put = await step(`add ${name} at ${view.label}`, () => view.client.put(name, definition.server, Number(definition.addedAt) || addAt, editedAt));
      if (!put) continue;
      view.listing.servers.push({ name, url, enabled: definition.server.enabled === true, addedAt: Number(definition.addedAt) || addAt, editedAt, settings: serverAt(source, url).settings, signIn: { role: "none" } });
      result.added.push({ name, place: view.label });
    }
    have = views.filter((view) => serverAt(view, url));

    // the app's own settings, everywhere: as the place where the person changed them last has them
    const edited = have.reduce((best, view) => (serverAt(view, url).editedAt > serverAt(best, url).editedAt ? view : best), have[0]);
    const editedAt = serverAt(edited, url).editedAt;
    let settings = null;
    for (const view of have) {
      const server = serverAt(view, url);
      if (view === edited || editedAt <= 0 || server.editedAt >= editedAt || server.settings === serverAt(edited, url).settings) continue;
      settings ??= await step(`read ${serverAt(edited, url).name} at ${edited.label}`, () => edited.client.definition(serverAt(edited, url).name));
      if (!record(settings?.server)) break;
      const put = await step(`update ${server.name} at ${view.label}`, () => view.client.put(server.name, settings.server, server.addedAt || addAt, editedAt));
      if (!put) continue;
      Object.assign(server, { editedAt, settings: serverAt(edited, url).settings, enabled: settings.server.enabled === true });
      result.edited.push({ name: server.name, place: view.label });
    }

    // a sign-out anywhere ends every sign-in made before it
    const outAt = latest(views.map((view) => view.listing.signedOut[url]));
    for (const view of have) {
      const server = serverAt(view, url);
      if ((server.signIn.role === "holder" || server.signIn.role === "lent") && (server.signIn.signedInAt ?? 0) <= outAt && outAt > 0) {
        if (await step(`sign out of ${server.name} at ${view.label}`, () => view.client.signOut(server.name, outAt))) {
          server.signIn = { role: "none" };
          result.signedOut.push({ name: server.name, place: view.label });
        }
      }
    }

    const holders = have.filter((view) => serverAt(view, url).signIn.role === "holder")
      .sort((a, b) => a.rank - b.rank || (serverAt(b, url).signIn.signedInAt ?? 0) - (serverAt(a, url).signIn.signedInAt ?? 0));
    if (!holders.length) continue;
    let holder = holders[0];

    // the refresh token goes to the place that is always on, as a move does: taken, held there, then let go of here
    const best = [...have].sort((a, b) => a.rank - b.rank)[0];
    if (best.rank < holder.rank && serverAt(best, url).signIn.role !== "holder") {
      const from = holder, to = best, fromName = serverAt(from, url).name, toName = serverAt(to, url).name;
      const moved = await step(`move ${fromName}'s sign-in to ${to.label}`, async () => {
        let replaces = null;
        for (let tries = 0; tries < 3; tries++) {
          const taken = await from.client.take(fromName);
          if (!record(taken?.record) || typeof taken.digest !== "string") throw new Error("nothing to take");
          const adopted = await to.client.adopt(toName, { record: taken.record, signedInAt: taken.signedInAt }, replaces);
          if (adopted.kept) throw new Error("kept its own");
          const released = await from.client.release(fromName, taken.digest, to.label);
          if (released.released) return true;
          replaces = taken.digest;
        }
        throw new Error("it kept refreshing");
      });
      if (moved) {
        serverAt(to, url).signIn = { ...serverAt(from, url).signIn, role: "holder" };
        serverAt(from, url).signIn = { role: "lent", signedInAt: serverAt(to, url).signIn.signedInAt };
        holder = to;
        result.moved.push({ name: toName, from: from.label, to: to.label });
      }
    }

    // every other place uses the holder's token
    const holderName = serverAt(holder, url).name, holderSignIn = serverAt(holder, url).signIn;
    let lent = null;
    for (const view of have) {
      if (view === holder) continue;
      const server = serverAt(view, url);
      if (server.signIn.role === "holder") continue;
      const fresh = server.signIn.role === "lent" && server.signIn.digest && server.signIn.digest === holderSignIn.digest
        && (!server.signIn.expiresAt || server.signIn.expiresAt - now() > TOPUP_MS);
      if (fresh) continue;
      lent ??= await step(`lend ${holderName} from ${holder.label}`, () => holder.client.lend(holderName));
      if (typeof lent?.access !== "string") break;
      const taken = await step(`lend ${server.name} to ${view.label}`, () => view.client.borrow(server.name, {
        access: lent.access, ...(Number.isFinite(lent.expiresAt) ? { expiresAt: lent.expiresAt } : {}), from: holder.label, grantAt: Number(lent.grantAt) || now(),
      }));
      if (taken?.borrowed) result.lent.push({ name: server.name, place: view.label });
    }
  }
  return result;
}

/**
 * Coming home from a Cloud that ended (one-home-again.mjs): each sign-in it holds comes to this computer, with its
 * server when this computer lacks it, so nothing needs connecting again. `remote`: remotePlace over the export session;
 * `local`: writes over this computer's loopback. Returns the names brought; a failure leaves that one where it was.
 */
export async function bringSignInsHome(remote, local, { label = "This computer" } = {}) {
  const there = await remote.list().catch(() => null), here = await local.list().catch(() => null);
  if (!there || !here) return [];
  const brought = [];
  for (const server of there.servers.filter((entry) => entry.signIn.role === "holder")) {
    try {
      let mine = here.servers.find((entry) => entry.url === server.url);
      if (mine?.signIn.role === "holder") continue;
      if (!mine) {
        if (here.servers.some((entry) => entry.name === server.name)) continue;
        const definition = await remote.definition(server.name);
        if (!record(definition?.server)) continue;
        await local.put(server.name, definition.server, Number(definition.addedAt) || Date.now());
        mine = { name: server.name };
      }
      let replaces = null;
      for (let tries = 0; tries < 3; tries++) {
        const taken = await remote.take(server.name);
        if (!record(taken?.record) || typeof taken.digest !== "string") break;
        const adopted = await local.adopt(mine.name, { record: taken.record, signedInAt: taken.signedInAt }, replaces);
        if (adopted.kept) break;
        const released = await remote.release(server.name, taken.digest, label);
        if (released.released) { brought.push(mine.name); break; }
        replaces = taken.digest;
      }
    } catch { /* stays on the Cloud's copy */ }
  }
  return brought;
}
