// "Start fresh": the bot panel's reset for testing. It deletes everything this person has with dusk bot, in an order that
// never strands anything: their own linked servers first (dusk bot's data there deleted while this app can still reach
// them, then unlinked), each dusk cloud plan cancelled, then the account deleted (its clouds destroyed now, not at the
// paid period's end) and signed out, then this computer's AI keys, then this computer's data, which goes at the next start,
// before anything opens it. A step that fails (a server offline) never stops the rest; it is listed with a retry, and the
// person may finish without it.
//
// Security: every step acts as this app's own sign-ins (the account service by its bearer, a server by this app's session
// there), so the services decide what is this person's: a cloud of someone else's is refused (404), a server they don't
// own refuses its wipe (403) and is only forgotten here. The account step never runs while a plan cancel failed, so a
// subscription is always cancelled before its account goes. A failed account delete keeps the sign-in, so a retry works
// and the app is never half signed in.
import nodeFs from "node:fs";
import path from "node:path";

import { DATA_DIR_NAMES, SERVER_CHILD_DIR, SERVER_LEASE_NAME } from "./legacy-names.mjs";

export const CONFIRM_PHRASE = "delete everything";
export const confirmed = (typed) => typeof typed === "string" && typed.trim().toLowerCase() === CONFIRM_PHRASE;

/** userData's marker: the next start deletes this computer's data before anything reads it */
export const DESKTOP_MARKER = "start-fresh.pending";
/** what in a data folder isn't the person's: the running server's lease and child, downloaded tools and caches */
const KEPT_IN_DATA = new Set(["tools", "cache", ".cache", "tmp", ".tmp", "dist-native", "tunnel-runtime", SERVER_CHILD_DIR, SERVER_LEASE_NAME]);
export const keptInDataDir = (name) => KEPT_IN_DATA.has(name) || name.startsWith(`${SERVER_LEASE_NAME}.`);
/** userData files that hold nothing of the person's: where the window was, the startup look, the updater's id */
const KEPT_IN_USER_DATA = new Set(["window-state.json", "startup-theme.json", "startup-loads.json", "last-run-version.json", "server-compile-cache", DESKTOP_MARKER]);
/** userData folders that are dusk bot's own (the rest is Chromium's, cleared through its session) */
const OWN_FOLDERS = /^(cloud-sync(-.+)?|vps-backups)$/;

const errorText = (error) => String(error?.message ?? error ?? "failed").slice(0, 200);

/**
 * @param {{
 *   servers(): Array<{ id: string, name: string, origin: string, uninstall?: string }>,
 *   wipeServer(server: { id: string, origin: string }): Promise<"wiped" | "not-owner">,
 *   unlinkServer(server: { id: string, origin: string }): Promise<void>,
 *   account(): { email: string, clouds: Array<{ id: string, name: string }> } | null,
 *   cancelPlan(cloudId: string): Promise<void>,
 *   deleteAccount(email: string): Promise<void>,
 *   signOut(): Promise<void>,
 *   removeAiKeys(): Promise<void>,
 *   markLocal(): void,
 *   relaunch(): void,
 *   changed?(view: any): void,
 *   log?(line: string): void,
 * }} deps
 */
export function createStartFresh(deps) {
  const { changed = () => {}, log = () => {} } = deps;
  let steps = [];
  let phase = "idle";
  let running = null;

  const view = () => ({ phase, steps: steps.map(({ run: _run, ...step }) => ({ ...step })) });
  const publish = () => { const next = view(); changed(next); return next; };

  /** what would go, read fresh: the dialog's list and the run's steps */
  function plan() {
    const list = [];
    for (const server of deps.servers()) {
      list.push({ id: `server:${server.id}`, kind: "server", label: server.name, ...(server.uninstall ? { uninstall: server.uninstall } : {}), run: async () => {
        const wiped = await deps.wipeServer(server);
        await deps.unlinkServer(server);
        return wiped === "not-owner" ? "unlinked" : null;
      } });
    }
    const account = deps.account();
    if (account) {
      for (const cloud of account.clouds) list.push({ id: `plan:${cloud.id}`, kind: "plan", label: cloud.name, run: () => deps.cancelPlan(cloud.id) });
      // the clouds and the account go together: deleting the account destroys its clouds now
      list.push({ id: "account", kind: "account", label: account.email, clouds: account.clouds.length, run: async () => {
        const blocked = steps.some((step) => step.kind === "plan" && step.status !== "done");
        if (blocked) throw Object.assign(new Error("A dusk cloud plan isn't cancelled yet."), { code: "plan_first" });
        await deps.deleteAccount(account.email);
        await deps.signOut().catch((error) => log(`start fresh: sign-out after delete (${errorText(error)})`));
      } });
    }
    list.push({ id: "ai", kind: "ai", label: "", run: () => deps.removeAiKeys() });
    list.push({ id: "local", kind: "local", label: "", run: async () => {} });
    return list;
  }

  async function runStep(step) {
    step.status = "running"; delete step.error; delete step.code; delete step.note;
    publish();
    try {
      const note = await step.run();
      step.status = "done";
      if (note) step.note = note;
    } catch (error) {
      step.status = "failed";
      step.error = errorText(error);
      if (typeof error?.code === "string") step.code = error.code;
      log(`start fresh: ${step.id} failed (${step.error})`);
    }
    publish();
  }

  async function pass(only) {
    phase = "running";
    publish();
    for (const step of steps) if (!only || only.has(step.id)) await runStep(step);
    phase = steps.some((step) => step.status === "failed") ? "partial" : "done";
    return publish();
  }

  const once = (work) => {
    if (running) return running;
    running = work().finally(() => { running = null; });
    return running;
  };

  return {
    view,
    /** the list the dialog shows before anything is deleted */
    preview: () => (phase === "idle" ? { phase, steps: plan().map(({ run: _run, ...step }) => ({ ...step, status: "pending" })) } : view()),
    /** runs every step once; `typed` must be the confirm phrase, whatever the page let through */
    run: (typed) => once(async () => {
      if (!confirmed(typed)) throw Object.assign(new Error("Type the confirm words first."), { code: "not_confirmed" });
      if (phase !== "idle") return view();
      steps = plan().map((step) => ({ ...step, status: "pending" }));
      // this computer's part is marked before anything else goes: quit halfway, and the next start still comes back new
      deps.markLocal();
      return pass(null);
    }),
    /** runs again only what failed; the account step waits on its plans, so they go first as before */
    retry: () => once(async () => {
      if (phase !== "partial") return view();
      return pass(new Set(steps.filter((step) => step.status === "failed").map((step) => step.id)));
    }),
    /** this computer's data goes at the next start (marked when the run began): the app starts again into its first run */
    finish: () => once(async () => {
      if (phase !== "done" && phase !== "partial") return view();
      phase = "restarting";
      publish();
      deps.relaunch();
      return view();
    }),
  };
}

/**
 * At start, before anything reads them: when a start-fresh is pending, this computer's data folders and dusk bot's own files
 * in userData are deleted. True when it ran, so the caller clears the window's storage too. The marker goes last, so a
 * start cut off halfway deletes again.
 * @param {{ userData: string, dataDir: string, fs?: typeof nodeFs, log?: (line: string) => void }} input
 */
export function applyPendingDesktopStartFresh({ userData, dataDir, fs = nodeFs, log = () => {} }) {
  const marker = path.join(userData, DESKTOP_MARKER);
  if (!fs.existsSync(marker)) return false;
  const rm = (target) => { try { fs.rmSync(target, { recursive: true, force: true }); } catch (error) { log(`start fresh: could not delete ${target} (${errorText(error)})`); } };
  // named local workspaces this app made, read before environments.json goes; only folders named like a data folder
  const extra = new Set([`${dataDir}-clean`]);
  let names = [];
  try { names = fs.readdirSync(userData); } catch {}
  for (const name of names.filter((one) => /^environments(-.+)?\.json$/.test(one))) {
    try {
      const saved = JSON.parse(fs.readFileSync(path.join(userData, name), "utf8"));
      for (const entry of Array.isArray(saved?.environments) ? saved.environments : []) {
        if (entry?.kind === "local" && typeof entry.dataDir === "string" && path.isAbsolute(entry.dataDir) && DATA_DIR_NAMES.some((prefix) => path.basename(entry.dataDir).startsWith(prefix))) extra.add(path.resolve(entry.dataDir));
      }
    } catch {}
  }
  extra.delete(path.resolve(dataDir));
  try { for (const name of fs.readdirSync(dataDir)) if (!keptInDataDir(name)) rm(path.join(dataDir, name)); } catch (error) { if (error?.code !== "ENOENT") log(`start fresh: ${errorText(error)}`); }
  for (const dir of extra) rm(dir);
  for (const name of names) {
    if (KEPT_IN_USER_DATA.has(name)) continue;
    if (/\.(json|bin)$/.test(name) || /\.unreadable-\d+$/.test(name) || OWN_FOLDERS.test(name)) rm(path.join(userData, name));
  }
  rm(marker);
  return true;
}

export function markDesktopStartFresh(userData, fs = nodeFs) {
  fs.mkdirSync(userData, { recursive: true });
  fs.writeFileSync(path.join(userData, DESKTOP_MARKER), JSON.stringify({ v: 1, at: Date.now() }), { mode: 0o600 });
}
