import fs from "node:fs";
import path from "node:path";

export const ROUTINE_WAKE_POLL_MS = 60_000;
/** After a wake, the network counts as back after this many online reads in a row, one per ONLINE_POLL_MS. */
export const ONLINE_READS = 2;
export const ONLINE_POLL_MS = 2_000;
/** Routines go ahead after this even without the network, as they did before the hold. */
export const ONLINE_WAIT_MS = 120_000;
const NOTIFY_ATTEMPTS = 3;

/** Keeps the system from idle-sleeping while letting the display turn off. */
export const ROUTINE_WAKE_BLOCKER = "prevent-app-suspension";

export function routineWakeDecision({ enabled, onBattery, status }) {
  if (!enabled) return { hold: false, reason: "off", at: null };
  if (onBattery) return { hold: false, reason: "battery", at: null };
  if (!status || status.hold !== true) return { hold: false, reason: "idle", at: null };
  return { hold: true, reason: status.reason === "running" ? "running" : "due", at: typeof status.at === "number" ? status.at : null };
}

const settingsFile = (userData) => path.join(userData, "routine-wake.json");

export function routineWakeSettings(userData) {
  try {
    const parsed = JSON.parse(fs.readFileSync(settingsFile(userData), "utf8"));
    return { keepAwake: parsed?.keepAwake !== false };
  } catch {
    return { keepAwake: true };
  }
}

export function rememberRoutineWake(userData, keepAwake) {
  const file = settingsFile(userData);
  const temporary = `${file}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(temporary, JSON.stringify({ keepAwake: keepAwake !== false }, null, 2));
    fs.renameSync(temporary, file);
  } catch {
    try {
      fs.unlinkSync(temporary);
    } catch {
    }
  }
}

/**
 * `deps`:
 * - fetchStatus(): Promise<{hold, reason?, at?} | null>, the server's answer, null when unreachable
 * - isOnBattery(): boolean
 * - blocker: { start(type): id, stop(id), isStarted(id): boolean }, Electron's powerSaveBlocker
 * - settings(): { keepAwake: boolean }
 * - log(line)
 * - powerMonitor?: { on(event, listener) }, Electron's, once the app is ready
 * - isOnline?(): boolean, Electron's net.isOnline
 * - notify?(event): Promise<unknown>, tells the server "suspend", "resume" or "online" (POST /api/routines/wake)
 */
export function createRoutineWakeHold(deps) {
  let blockerId = null;
  let timer = null;
  let last = { hold: false, reason: "idle", at: null };

  const apply = (decision) => {
    if (decision.hold && blockerId === null) {
      blockerId = deps.blocker.start(ROUTINE_WAKE_BLOCKER);
      deps.log?.(`routine wake: holding this computer awake (${decision.reason}${decision.at ? ` at ${new Date(decision.at).toISOString()}` : ""})`);
    } else if (!decision.hold && blockerId !== null) {
      if (deps.blocker.isStarted(blockerId)) deps.blocker.stop(blockerId);
      blockerId = null;
      deps.log?.(`routine wake: released (${decision.reason})`);
    }
    last = decision;
  };

  const poll = async () => {
    const status = await Promise.resolve()
      .then(() => deps.fetchStatus())
      .catch(() => null);
    apply(routineWakeDecision({ enabled: deps.settings().keepAwake, onBattery: deps.isOnBattery(), status }));
    return state();
  };

  const state = () => ({ ...last, keepAwake: deps.settings().keepAwake, onBattery: deps.isOnBattery() });

  const wake = watchWake(deps);

  return {
    start() {
      if (timer) return;
      wake.watch();
      void poll();
      timer = setInterval(() => void poll(), deps.pollMs ?? ROUTINE_WAKE_POLL_MS);
      timer.unref?.();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
      apply({ hold: false, reason: "stopped", at: null });
    },
    poll,
    state,
    holding: () => blockerId !== null,
  };
}

/** Tells the server when this computer sleeps and wakes, and when the network is back after a wake. */
export function watchWake(deps) {
  let watching = false;
  let waking = null;
  const pause = (ms) => new Promise((resolve) => { const t = setTimeout(resolve, ms); t.unref?.(); });

  const tell = async (event) => {
    for (let attempt = 1; attempt <= NOTIFY_ATTEMPTS; attempt++) {
      try {
        await deps.notify(event);
        return true;
      } catch {
        if (attempt < NOTIFY_ATTEMPTS) await pause(1_000);
      }
    }
    deps.log?.(`routine wake: the server did not hear "${event}"`);
    return false;
  };

  const awaitNetwork = async (run) => {
    const started = Date.now();
    let online = 0;
    while (run === waking && Date.now() - started < (deps.onlineWaitMs ?? ONLINE_WAIT_MS)) {
      online = deps.isOnline() ? online + 1 : 0;
      if (online >= ONLINE_READS) break;
      await pause(deps.onlinePollMs ?? ONLINE_POLL_MS);
    }
    if (run !== waking) return;
    waking = null;
    if (online < ONLINE_READS) deps.log?.(`routine wake: no network ${Math.round((deps.onlineWaitMs ?? ONLINE_WAIT_MS) / 1_000)} s after waking; routines go ahead`);
    await tell("online");
  };

  return {
    watch() {
      if (watching || !deps.powerMonitor || !deps.notify || !deps.isOnline) return;
      watching = true;
      deps.powerMonitor.on("suspend", () => {
        waking = null;
        void tell("suspend");
      });
      deps.powerMonitor.on("resume", () => {
        const run = {};
        waking = run;
        void tell("resume").then(() => awaitNetwork(run));
      });
    },
  };
}
