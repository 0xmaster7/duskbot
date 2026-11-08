import { z } from "zod";
import type { SlackWorkspaceStatus } from "../../shared/slack.ts";
import { SlackApiError, type SlackApi } from "./api.ts";
import { SlackSecretsUnavailable, type SlackSecretStore, type SlackWorkspaceRecord } from "./secrets.ts";

export interface ConfigTokenDeps {
  store: SlackSecretStore;
  api: SlackApi;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => { cancel(): void };
  log?: (line: string) => void;
}

const minute = 60_000;
const reconnectError = "Slack stopped accepting the workspace token. Connect the workspace again.";
const rotationSchema = z.object({
  token: z.string().min(1).max(4096), refresh_token: z.string().min(1).max(4096),
  exp: z.number().int().positive().max(Number.MAX_SAFE_INTEGER / 1000),
  team_id: z.string().min(1).max(64), user_id: z.string().min(1).max(64).optional(),
});

export function createConfigTokens(deps: ConfigTokenDeps) {
  const { store, api } = deps;
  const now = deps.now ?? Date.now;
  const log = deps.log ?? (() => {});
  const setTimer = deps.setTimer ?? ((fn, ms) => {
    const timer = setTimeout(fn, ms);
    timer.unref();
    return { cancel: () => clearTimeout(timer) };
  });
  let timer: { cancel(): void } | undefined;
  let inFlight: Promise<string> | null = null;
  let generation = 0;
  let running = true;
  let failures = 0;

  function cancelTimer() {
    timer?.cancel();
    timer = undefined;
  }

  function schedule(ms: number) {
    cancelTimer();
    if (!running) return;
    timer = setTimer(() => {
      timer = undefined;
      void rotate().catch(() => { log("Slack workspace token rotation did not complete."); });
    }, ms);
  }

  function scheduleRecord(record: SlackWorkspaceRecord) {
    schedule(Math.max(minute, record.expiresAt - now() - 30 * minute));
  }

  async function rotatePair(refreshToken: string, accessToken: string) {
    try {
      const parsed = rotationSchema.safeParse(await api.call("tooling.tokens.rotate", null, { refresh_token: refreshToken }));
      if (!parsed.success || parsed.data.exp * 1000 <= now()) throw new SlackApiError("bad_response");
      return parsed.data;
    } catch (error) {
      if (error instanceof SlackApiError && ![refreshToken, accessToken].some((value) => value && error.message.includes(value))) throw error;
      throw new SlackApiError(error instanceof SlackApiError ? "bad_response" : "network");
    }
  }

  function status(apps: number): SlackWorkspaceStatus {
    const ready = store.ready();
    const record = store.workspace();
    return record ? {
      version: 1, state: record.state, teamId: record.teamId, teamName: record.teamName,
      expiresAt: record.expiresAt, ...(record.error ? { error: record.error } : {}), apps, ready,
    } : { version: 1, state: "not_connected", apps, ready };
  }

  function rotate(): Promise<string> {
    if (inFlight) return inFlight;
    const record = store.workspace();
    if (!record || record.state !== "connected") return Promise.reject(new SlackApiError("needs_reconnect"));
    const currentGeneration = generation;
    cancelTimer();
    const operation = (async () => {
      try {
        const pair = await rotatePair(record.refreshToken, record.configToken);
        if (currentGeneration !== generation) throw new SlackApiError("needs_reconnect");
        const next: SlackWorkspaceRecord = {
          ...record, configToken: pair.token, refreshToken: pair.refresh_token,
          expiresAt: pair.exp * 1000, rotatedAt: now(), state: "connected",
        };
        delete next.error;
        store.setWorkspace(next);
        failures = 0;
        scheduleRecord(next);
        return next.configToken;
      } catch (error) {
        if (currentGeneration !== generation) throw new SlackApiError("needs_reconnect");
        const transient = error instanceof SlackApiError && (error.code === "network" || error.code === "server_error" ||
          (error.status !== undefined && error.status >= 500 && error.status <= 599));
        if (transient && now() < record.expiresAt) {
          const delay = [minute, 5 * minute, 15 * minute][Math.min(failures++, 2)];
          schedule(Math.min(delay, record.expiresAt - now()));
          log("Slack workspace token rotation will be retried.");
          return record.configToken;
        }
        store.setWorkspace({ ...record, state: "needs_reconnect", error: reconnectError });
        log("Slack workspace connection needs to be renewed.");
        throw new SlackApiError("needs_reconnect");
      }
    })();
    inFlight = operation;
    void operation.finally(() => { if (inFlight === operation) inFlight = null; }).catch(() => {});
    return operation;
  }

  return {
    async connect(accessToken: string, refreshToken: string): Promise<SlackWorkspaceStatus> {
      if (!store.ready()) throw new SlackSecretsUnavailable();
      const currentGeneration = ++generation;
      cancelTimer();
      inFlight = null;
      const pair = await rotatePair(refreshToken, accessToken);
      let teamName = pair.team_id;
      try {
        const auth = z.object({ team: z.string().min(1).max(200) }).safeParse(await api.call("auth.test", pair.token));
        if (auth.success) teamName = auth.data.team;
      } catch { log("Slack workspace name could not be read."); }
      if (currentGeneration !== generation) throw new SlackApiError("needs_reconnect");
      const record: SlackWorkspaceRecord = {
        teamId: pair.team_id, teamName, ...(pair.user_id ? { userId: pair.user_id } : {}),
        configToken: pair.token, refreshToken: pair.refresh_token, expiresAt: pair.exp * 1000,
        state: "connected", connectedAt: now(), rotatedAt: now(),
      };
      store.setWorkspace(record);
      failures = 0;
      running = true;
      scheduleRecord(record);
      return status(store.bots().length);
    },
    disconnect() {
      generation++;
      cancelTimer();
      inFlight = null;
      failures = 0;
      store.setWorkspace(null);
    },
    async token(): Promise<string> {
      const record = store.workspace();
      if (!record || record.state !== "connected") throw new SlackApiError("needs_reconnect");
      if (inFlight) return inFlight;
      return record.expiresAt - now() <= 10 * minute ? rotate() : record.configToken;
    },
    status,
    start() {
      running = true;
      cancelTimer();
      const record = store.workspace();
      if (!record || record.state !== "connected") return;
      if (record.expiresAt - now() <= 30 * minute) {
        void rotate().catch(() => { log("Slack workspace token rotation did not complete."); });
      } else scheduleRecord(record);
    },
    stop() { running = false; cancelTimer(); },
  };
}
