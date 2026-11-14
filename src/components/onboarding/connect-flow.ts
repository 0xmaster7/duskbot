// One AI being connected, as stages with a deadline each: waking the cloud, getting the AI ready (a fresh status read,
// then the provider's official helper downloaded when it is missing), opening its sign-in, waiting for the person, and
// confirming. A stage that runs past its deadline ends in a plain message with Try again, never a spinner left alone.
// Kept free of React so a remount (StrictMode, a closed dialog) can't strand it and each transition is testable.
import { deviceSignInLink, isDeviceSignInCode, type DeviceSignInProvider } from "../../../shared/device-sign-in";
import { friendlyError } from "@/lib/plain-error";

export type ConnectStageName = "waking" | "preparing" | "installing" | "opening" | "waiting" | "confirming";

/** How the person finishes signing in: a code at the provider's page, a link that comes back here by itself, a code
 * pasted back (Claude), or a provider page that calls back to this machine (managed engines). */
export type WaitKind = "device" | "browser" | "paste" | "callback";

export type ConnectState =
  | { stage: "idle" }
  | { stage: "waking"; since: number }
  | { stage: "preparing"; since: number }
  | { stage: "installing"; since: number; downloadBytes: number | null }
  | { stage: "opening"; since: number }
  | { stage: "waiting"; since: number; kind: WaitKind; flowId: string; link: string | null; code: string | null; opened: boolean }
  | { stage: "confirming"; since: number }
  | { stage: "connected"; reused: boolean }
  | { stage: "failed"; at: ConnectStageName; reason: FailReason; message: string | null; link: string | null };

/** Why a stage ended: a timeout, the sign-in lost, the AI unusable here, or the provider's own refusal (its `message`). */
export type FailReason = "timeout" | "lost" | "unavailable" | "error";

export interface ConnectInstance {
  instanceId: string;
  driverKind: string;
  access?: string;
  snapshot: { state: string; authenticated?: boolean; reason?: string; authenticationUnavailableReason?: string };
  authentication?: { method: "device-code" | "paste-code" | "browser" | "browser-pkce" };
  install?: { server?: { standalone?: { downloadBytes?: number } } | unknown; managed?: { downloadBytes?: number } | unknown };
}

export interface ConnectTimeouts {
  waking: number;
  preparing: number;
  installing: number;
  opening: number;
  waiting: number;
  confirming: number;
}

export const CONNECT_TIMEOUTS: ConnectTimeouts = {
  waking: 3 * 60_000,
  preparing: 45_000,
  // the server gives npm 10 minutes; a download that slow is better retried by the person than watched
  installing: 8 * 60_000,
  opening: 60_000,
  // device codes last 15 minutes (Codex, GitHub, Grok)
  waiting: 15 * 60_000,
  confirming: 45_000,
};

export const POLL_MS = 2_000;
/** Status checks in a row that got no answer before the sign-in says it lost track. */
export const LOST_AFTER = 5;
const CHECKING = /^Checking engine status$/;

export interface ConnectDeps {
  api<T = unknown>(path: string, init?: { method?: string; body?: string; signal?: AbortSignal }): Promise<T>;
  /** Reads every AI's status again and answers with the fresh list. */
  refresh(): Promise<readonly ConnectInstance[]>;
  /** Opens a link in the person's browser; false when it could not. */
  open(link: string): Promise<boolean>;
  trail(ev: string, fields: Record<string, string | number | boolean | null | undefined>): void;
  /** The cloud is asleep or waking right now. */
  waking?(): boolean;
  now?(): number;
  timeouts?: Partial<ConnectTimeouts>;
}

export interface ConnectTarget {
  /** The card's name for the trail and the messages ("chatgpt"). */
  tile: string;
  /** The instances that are this AI, best first: the first usable one is connected, a signed-in one is reused. */
  candidates: readonly string[];
}

export function ready(instance: ConnectInstance): boolean {
  return instance.snapshot.state === "available" && (instance.access === "custom" || instance.snapshot.authenticated !== false);
}

/** Whether this AI can get from where it is to signed in without leaving the app. */
export function connectsInApp(instance: ConnectInstance): boolean {
  if (instance.snapshot.authenticationUnavailableReason) return false;
  if (instance.snapshot.state === "available") return instance.snapshot.authenticated === false ? Boolean(instance.authentication) : true;
  return Boolean(instance.install?.server || instance.install?.managed) || CHECKING.test(instance.snapshot.reason ?? "");
}

export function signInProvider(driverKind: string): DeviceSignInProvider {
  switch (driverKind) {
    case "grokAgent": return "grok";
    case "kimiAgent": return "kimi";
    case "copilotAgent": return "copilot";
    case "cursorAgent": return "cursor";
    default: return "codex";
  }
}

/** ChatGPT's own authorize page, and nothing else. */
export function chatgptPlanLink(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.origin === "https://auth.openai.com" && url.pathname === "/api/accounts/authorize" && !url.username && !url.password && !url.hash ? url.href : null;
  } catch { return null; }
}

/** An https page with no login or fragment: the managed engines' provider page (Google for Antigravity). */
function httpsLink(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

class StageEnded extends Error {
  constructor(readonly reason: FailReason, readonly detail: string | null = null, readonly waking = false) { super(reason); }
}

const STAGES: readonly string[] = ["waking", "preparing", "installing", "opening", "waiting", "confirming"];

const wakingError = (cause: unknown): boolean => {
  const error = cause as { status?: number; body?: { error?: unknown } } | null;
  return error?.status === 503 && (error.body?.error === "waking" || error.body?.error === "asleep");
};

const messageOf = (cause: unknown): string | null => (cause instanceof Error && cause.message ? friendlyError(cause) : null);

type Listener = (state: ConnectState) => void;

/** Runs one connect at a time; `start` on a running one cancels it first. */
export class ConnectFlow {
  state: ConnectState = { stage: "idle" };
  target: ConnectTarget | null = null;
  private instanceId = "";
  private flowId = "";
  private run = 0;
  private abort: AbortController | null = null;
  private listeners = new Set<Listener>();
  private readonly limits: ConnectTimeouts;
  private readonly deps: ConnectDeps;
  private pasteDone: ((code: string) => void) | null = null;

  constructor(deps: ConnectDeps) {
    this.deps = deps;
    this.limits = { ...CONNECT_TIMEOUTS, ...deps.timeouts };
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /** The instance the flow is connecting now. */
  get instance(): string { return this.instanceId; }

  get running(): boolean {
    return !["idle", "connected", "failed"].includes(this.state.stage);
  }

  private now(): number { return this.deps.now?.() ?? Date.now(); }

  private set(next: ConnectState, run: number): void {
    if (run !== this.run) return;
    const before = this.state;
    this.state = next;
    if (before.stage !== next.stage || next.stage === "waiting") {
      const fields = { tile: this.target?.tile, instance: this.instanceId, from: before.stage };
      if (next.stage === "failed") this.deps.trail(next.reason === "timeout" ? "connect.timeout" : "connect.fail", { ...fields, stage: next.at, reason: next.reason });
      else if (next.stage === "connected") this.deps.trail("connect.done", { ...fields, reused: next.reused });
      else if (next.stage !== "idle") this.deps.trail("connect.stage", { ...fields, stage: next.stage,
        ...(next.stage === "waiting" ? { kind: next.kind, opened: next.opened, link: Boolean(next.link), code: Boolean(next.code) } : {}) });
    }
    for (const listener of this.listeners) listener(next);
  }

  start(target: ConnectTarget): void {
    if (this.running) this.cancel();
    this.target = target;
    const run = ++this.run;
    this.abort = new AbortController();
    void this.connect(run, this.abort.signal);
  }

  retry(): void {
    if (this.target) this.start(this.target);
  }

  /** Stops what is running; a sign-in under way is cancelled on the server too, so its helper doesn't linger. */
  cancel(): void {
    const state = this.state;
    if (!this.running && state.stage !== "failed") return;
    const run = ++this.run;
    this.abort?.abort();
    this.abort = null;
    this.pasteDone = null;
    if (state.stage === "waiting" && this.instanceId) {
      void this.deps.api(`/api/instances/${encodeURIComponent(this.instanceId)}/auth/cancel`, { method: "POST", body: JSON.stringify({ flowId: state.flowId }) }).catch(() => {});
    }
    if (this.running) this.deps.trail("connect.cancel", { tile: this.target?.tile, instance: this.instanceId, stage: state.stage });
    this.run = run;
    this.state = { stage: "idle" };
    for (const listener of this.listeners) listener(this.state);
  }

  /** Opens the sign-in page again; false when the browser would not open it. */
  async openAgain(): Promise<boolean> {
    const state = this.state;
    const link = state.stage === "waiting" || state.stage === "failed" ? state.link : null;
    if (!link) return false;
    const opened = await this.deps.open(link).catch(() => false);
    this.deps.trail("connect.open", { tile: this.target?.tile, instance: this.instanceId, opened, again: true });
    return opened;
  }

  /** The code a provider showed after sign-in (Claude), pasted back. */
  submit(code: string): void {
    if (this.state.stage === "waiting" && this.state.kind === "paste" && code.trim()) this.pasteDone?.(code.trim());
  }

  /** Races `work` against this stage's deadline and a cancel. */
  private within<T>(stage: ConnectStageName, signal: AbortSignal, work: (stageSignal: AbortSignal) => Promise<T>): Promise<T> {
    const stageAbort = new AbortController();
    const relay = () => stageAbort.abort();
    signal.addEventListener("abort", relay, { once: true });
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => { stageAbort.abort(); reject(new StageEnded("timeout")); }, this.limits[stage]);
      work(stageAbort.signal).then(resolve, reject).finally(() => {
        clearTimeout(timer);
        signal.removeEventListener("abort", relay);
      });
    });
  }

  /** One request that waits out a cloud waking up (stage "waking", then back to `stage`), within the waking deadline. */
  private async awake<T>(run: number, signal: AbortSignal, back: ConnectState, request: () => Promise<T>): Promise<T> {
    const wakeUntil = this.now() + this.limits.waking;
    for (;;) {
      try {
        if (this.deps.waking?.()) throw Object.assign(new Error("waking"), { status: 503, body: { error: "waking" } });
        const answer = await request();
        if (this.state.stage === "waking") this.set(back, run);
        return answer;
      } catch (cause) {
        if (signal.aborted || !wakingError(cause)) throw cause;
        if (this.now() >= wakeUntil) throw new StageEnded("timeout", null, true);
        if (this.state.stage !== "waking") this.set({ stage: "waking", since: this.now() }, run);
        await sleep(3_000, signal);
      }
    }
  }

  private find(instances: readonly ConnectInstance[], target: ConnectTarget): { reused: ConnectInstance | null; usable: ConnectInstance | null; first: ConnectInstance | null } {
    const mine = target.candidates.map((id) => instances.find((instance) => instance.instanceId === id)).filter(Boolean) as ConnectInstance[];
    return { reused: mine.find(ready) ?? null, usable: mine.find(connectsInApp) ?? null, first: mine[0] ?? null };
  }

  private async connect(run: number, signal: AbortSignal): Promise<void> {
    const target = this.target!;
    const base = (id: string) => `/api/instances/${encodeURIComponent(id)}`;
    let link: string | null = null;
    let latest: readonly ConnectInstance[] = [];
    const read = async () => {
      latest = await this.deps.refresh();
      return this.find(latest, target);
    };
    try {
      const preparing: ConnectState = { stage: "preparing", since: this.now() };
      this.set(this.deps.waking?.() ? { stage: "waking", since: this.now() } : preparing, run);

      // a fresh read first: a login that already works is reused, an install that is there is not downloaded again
      let found = await this.awake(run, signal, preparing, () => this.within("preparing", signal, async (stageSignal) => {
        let now = await read();
        while (!now.reused && now.usable && CHECKING.test(now.usable.snapshot.reason ?? "")) {
          await sleep(1_000, stageSignal);
          now = await read();
        }
        return now;
      }));
      if (this.state.stage === "waking") this.set(preparing, run);
      if (found.reused) {
        this.instanceId = found.reused.instanceId;
        return this.set({ stage: "connected", reused: true }, run);
      }
      let instance = found.usable;
      if (!instance) {
        this.instanceId = found.first?.instanceId ?? "";
        throw new StageEnded("unavailable", found.first?.snapshot.authenticationUnavailableReason ?? found.first?.snapshot.reason ?? null);
      }
      this.instanceId = instance.instanceId;

      if (instance.snapshot.state !== "available") {
        const install = instance.install as { server?: { standalone?: { downloadBytes?: number } }; managed?: { downloadBytes?: number } } | undefined;
        const downloadBytes = install?.server?.standalone?.downloadBytes ?? install?.managed?.downloadBytes ?? null;
        const installing: ConnectState = { stage: "installing", since: this.now(), downloadBytes };
        this.set(installing, run);
        const installId = instance.instanceId;
        await this.awake(run, signal, installing, () => this.within("installing", signal,
          (stageSignal) => this.deps.api(`${base(installId)}/install`, { method: "POST", signal: stageSignal })));
        found = await read();
        if (found.reused) return this.set({ stage: "connected", reused: false }, run);
        const now = found.usable ?? found.first;
        if (!now || now.snapshot.state !== "available") {
          throw new StageEnded("unavailable", now?.snapshot.authenticationUnavailableReason ?? now?.snapshot.reason ?? null);
        }
        instance = now;
        this.instanceId = instance.instanceId;
      }

      // in order: a ChatGPT plan sign-in refused on a remote machine falls back to the Codex code sign-in
      const signIns = [instance, ...target.candidates
        .filter((id) => id !== instance!.instanceId)
        .map((id) => latest.find((candidate) => candidate.instanceId === id))
        .filter((candidate): candidate is ConnectInstance => Boolean(candidate && candidate.snapshot.state === "available" && candidate.authentication && connectsInApp(candidate)))];
      let started: { auth: { phase: string; flowId?: string | null; authorizationUrl?: string | null; userCode?: string; message?: string } } | null = null;
      for (const [at, candidate] of signIns.entries()) {
        if (!candidate.authentication) continue;
        const opening: ConnectState = { stage: "opening", since: this.now() };
        this.set(opening, run);
        this.instanceId = candidate.instanceId;
        instance = candidate;
        try {
          started = await this.awake(run, signal, opening, () => this.within("opening", signal,
            (stageSignal) => this.deps.api(`${base(candidate.instanceId)}/auth/start`, { method: "POST", signal: stageSignal })));
          break;
        } catch (cause) {
          if ((cause as { status?: number }).status !== 403 || at === signIns.length - 1) throw cause;
          this.deps.trail("connect.fallback", { tile: target.tile, from: candidate.instanceId });
        }
      }
      if (!started) throw new StageEnded("unavailable");
      const { auth } = started;
      if (auth.phase === "succeeded") return await this.confirm(run, signal, target, false);
      if (auth.phase !== "waiting" || !auth.flowId) throw new StageEnded("error", auth.message ?? null);

      const method = instance.authentication!.method;
      const provider = signInProvider(instance.driverKind);
      const code = method === "device-code" && isDeviceSignInCode(provider, auth.userCode) && auth.userCode ? auth.userCode : null;
      link = method === "browser-pkce" ? chatgptPlanLink(auth.authorizationUrl)
        : method === "paste-code" || method === "browser" ? httpsLink(auth.authorizationUrl)
          : deviceSignInLink(provider, auth.authorizationUrl, code ?? undefined);
      const kind: WaitKind = method === "browser-pkce" ? "browser" : method === "paste-code" ? "paste" : method === "browser" ? "callback" : "device";
      const opened = link ? await this.deps.open(link).catch(() => false) : false;
      if (signal.aborted) return;
      this.deps.trail("connect.open", { tile: target.tile, instance: instance.instanceId, opened, again: false });
      this.flowId = auth.flowId;
      this.set({ stage: "waiting", since: this.now(), kind, flowId: auth.flowId, link, code, opened }, run);
      const waitingOn = instance;
      await this.within("waiting", signal, (stageSignal) => this.wait(run, stageSignal, waitingOn, auth.flowId!, kind, provider, target));
      await this.confirm(run, signal, target, false);
    } catch (cause) {
      if (signal.aborted || run !== this.run) return;
      const current = this.state.stage;
      const at = (cause instanceof StageEnded && cause.waking ? "waking" : STAGES.includes(current) ? current : "preparing") as ConnectStageName;
      const reason: FailReason = cause instanceof StageEnded ? cause.reason : "error";
      const message = cause instanceof StageEnded ? cause.detail : messageOf(cause);
      this.set({ stage: "failed", at, reason, message, link }, run);
      if (at === "waiting") this.cancelServerFlow();
    }
  }

  private cancelServerFlow(): void {
    const state = this.state;
    if (state.stage !== "failed" || state.at !== "waiting" || !this.instanceId || !this.flowId) return;
    void this.deps.api(`/api/instances/${encodeURIComponent(this.instanceId)}/auth/cancel`, { method: "POST", body: JSON.stringify({ flowId: this.flowId }) }).catch(() => {});
  }

  /** Until the sign-in finishes: polling the server's flow, or the AI's status for a callback, or the pasted code. */
  private async wait(run: number, signal: AbortSignal, instance: ConnectInstance, flowId: string, kind: WaitKind, provider: DeviceSignInProvider, target: ConnectTarget): Promise<void> {
    const base = `/api/instances/${encodeURIComponent(instance.instanceId)}`;
    if (kind === "paste") {
      const code = await new Promise<string>((resolve, reject) => {
        this.pasteDone = resolve;
        signal.addEventListener("abort", () => reject(new StageEnded("timeout")), { once: true });
      });
      this.pasteDone = null;
      const confirming: ConnectState = { stage: "confirming", since: this.now() };
      this.set(confirming, run);
      await this.deps.api(`${base}/auth/complete`, { method: "POST", body: JSON.stringify({ flowId, code }), signal });
      return;
    }
    let missed = 0;
    for (;;) {
      await sleep(POLL_MS, signal);
      try {
        if (kind === "callback") {
          if (this.find(await this.deps.refresh(), target).reused) return;
          missed = 0;
          continue;
        }
        const { auth } = await this.deps.api<{ auth: { phase: string; message?: string; userCode?: string; authorizationUrl?: string | null } }>(
          `${base}/auth/status?flowId=${encodeURIComponent(flowId)}`, { signal });
        missed = 0;
        if (auth.phase === "succeeded") return;
        if (auth.phase === "expired") throw new StageEnded("timeout");
        if (auth.phase !== "waiting") throw new StageEnded("error", auth.message ?? null);
        const state = this.state;
        if (state.stage === "waiting" && isDeviceSignInCode(provider, auth.userCode) && auth.userCode !== state.code) {
          this.set({ ...state, code: auth.userCode, link: deviceSignInLink(provider, auth.authorizationUrl, auth.userCode) ?? state.link }, run);
        }
      } catch (cause) {
        if (cause instanceof StageEnded || signal.aborted) throw cause;
        if (wakingError(cause)) continue;
        if (++missed >= LOST_AFTER) throw new StageEnded("lost");
      }
    }
  }

  /** The sign-in finished: read the AI again until it says it is ready. */
  private async confirm(run: number, signal: AbortSignal, target: ConnectTarget, reused: boolean): Promise<void> {
    if (this.state.stage !== "confirming") this.set({ stage: "confirming", since: this.now() }, run);
    await this.within("confirming", signal, async (stageSignal) => {
      for (;;) {
        const found = this.find(await this.deps.refresh().catch(() => []), target);
        if (found.reused) return;
        await sleep(POLL_MS, stageSignal);
      }
    });
    this.set({ stage: "connected", reused }, run);
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason ?? new Error("aborted"));
    const timer = setTimeout(() => { signal.removeEventListener("abort", stop); resolve(); }, ms);
    const stop = () => { clearTimeout(timer); reject(signal.reason ?? new Error("aborted")); };
    signal.addEventListener("abort", stop, { once: true });
  });
}
