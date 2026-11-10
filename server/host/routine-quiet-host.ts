// The server's side of quiet routines and the weekly allowance, wired once from index.ts: the allowance and its holds,
// probe checks beside the proactive ones, each routine's 3x self-cap, the waking hours new routines are shaped to, and
// how early a Cloud home may run an "around this time" routine.
import { createAllowance, money } from "../allowance.ts";
import { ledgerCost } from "../model-prices.ts";
import { createRoutineProbes, withProbes } from "../routine-probe.ts";
import { flexOf } from "../routine-quiet.ts";
import { nextOccurrence } from "../routine-schedules.ts";
import { createRoutineSelfCap } from "../routine-self-cap.ts";
import { shapeNewRoutine, useWakingWindow } from "../routine-shape.ts";
import type { Routine, RoutineChecks, RoutineManager, RoutineRun } from "../routines.ts";
import { serverLine } from "../server-lines.ts";
import type { Spend } from "../spend.ts";
import { fetchPublicPage } from "../wait-probes.ts";
import { createWakingHours } from "../waking-hours.ts";

export interface RoutineHostDeps {
  dataDir: string;
  cloudHome: boolean;
  spend: Spend;
  routines(): RoutineManager | null;
  botName(id: string): string | undefined;
  /** The bot's model and engine kind, for a running turn's price. */
  model(botId: string): { driverKind: string; model: string } | undefined;
  tell(botId: string, threadId: string | undefined, text: string): void;
  language(threadId: string | undefined): string | undefined;
  /** Only a verification fixture sets this (control-omb): one loopback origin its probes may read. */
  probeLoopbackOrigin?: string;
}

/** Enabled routines with a run before `until`, each once with its next time. */
export function upcomingRuns(routines: readonly Routine[], now: number, until: number): Array<{ routineId: string; name: string; at: number }> {
  return routines.flatMap((routine) => {
    if (!routine.enabled || routine.nextRunAt == null) return [];
    const at = routine.nextRunAt >= now ? routine.nextRunAt : nextOccurrence(routine.schedule, now);
    return at !== null && at < until ? [{ routineId: routine.id, name: routine.name, at }] : [];
  }).sort((a, b) => a.at - b.at);
}

export function createRoutineHost(deps: RoutineHostDeps) {
  const list = () => deps.routines()?.listRoutines() ?? [];
  const resultsThread = (routine: Pick<Routine, "resultsThreadId" | "sourceThreadId">) => routine.resultsThreadId ?? routine.sourceThreadId;
  const loopback = deps.probeLoopbackOrigin && /^http:\/\/127\.0\.0\.1:\d{1,5}$/.test(deps.probeLoopbackOrigin) ? deps.probeLoopbackOrigin : undefined;

  const allowance = createAllowance({
    dataDir: deps.dataDir,
    since: (at) => deps.spend.since(at),
    names: {
      bot: deps.botName,
      routine: (id) => { const routine = list().find((one) => one.id === id); return routine ? { name: routine.name, botId: routine.botId } : undefined; },
    },
    upcoming: (until) => upcomingRuns(list(), Date.now(), until),
    tell: (botId, text) => deps.tell(botId, undefined, text),
    language: () => deps.language(undefined),
  });

  const probes = createRoutineProbes({
    dataDir: deps.dataDir,
    fetch: (url) => fetchPublicPage(url, loopback && url.startsWith(`${loopback}/`) ? { allow: () => true } : {}),
    failed: (routine, sentence) => {
      const thread = resultsThread(routine);
      deps.tell(routine.botId, thread, serverLine(deps.language(thread), "server.routine.probeFailed", { routine: routine.name, reason: sentence }));
    },
  });

  const selfCap = createRoutineSelfCap({
    run: (threadId) => deps.routines()?.runForThread(threadId) ?? null,
    usual: (routineId) => deps.spend.usualRunUsd(routineId),
    estimate: (threadId, usage) => {
      const run = deps.routines()?.runForThread(threadId);
      const model = run ? deps.model(run.botId) : undefined;
      return model ? ledgerCost({ ...model, input: usage.input, output: usage.output, ...(usage.cachedInput !== undefined ? { cachedInput: usage.cachedInput } : {}), costUsd: null }, null).costUsd : null;
    },
    stop: (run: RoutineRun, reason, spent, usual) => {
      void deps.routines()?.cancelRun(run.id, reason);
      const thread = run.resultsThreadId ?? run.sourceThreadId, language = deps.language(thread);
      deps.tell(run.botId, thread, serverLine(language, "server.routine.selfCap", { routine: run.routineName, spent: money(spent, language), usual: money(usual, language) }));
    },
  });

  const wakingHours = createWakingHours({ dataDir: deps.dataDir });
  useWakingWindow(() => wakingHours.window());

  return {
    allowance,
    selfCap,
    wakingHours,
    checks: (inner: RoutineChecks | undefined): RoutineChecks => withProbes(inner, probes),
    /** Only a Cloud home runs an "around this time" routine early: it may fold it into a wake it has anyway. */
    earlyMs: deps.cloudHome ? (routine: Routine) => flexOf(routine) : undefined,
    shape: <T>(input: T): T => shapeNewRoutine(input as never) as T,
    /** A person's new task waits while the allowance is used up and Saver mode is off. */
    assertMayStart(threadId: string, continuing: boolean): void {
      if (continuing) return;
      const waiting = allowance.refusal(deps.language(threadId));
      if (waiting) throw Object.assign(new Error(waiting), { status: 409, code: "allowance" });
    },
  };
}
