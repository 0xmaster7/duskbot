// Which turns on a Cloud home act for its owner, read from the harness's own records (server/cloud-owner-turns.ts decides).
// A room member turn acts for the person's line that started its run, for that turn generation alone, while the run lasts.
import { ownerTurnRefusal, type CloudOwnerTurn } from "../cloud-owner-turns.ts";
import type { Routine, RoutineManager, RoutineRun } from "../routines.ts";
import { ranApart } from "../routine-run-definition.ts";
import type { Message, Store } from "../store.ts";
import type { RoomRun } from "./acting-person.ts";

type Turn = { botId: string; threadId: string; generation: string };

export interface CloudOwnerTurnsDeps {
  store: Pick<Store, "botByThread" | "groupByThread" | "messagesFor" | "taskByThread">;
  cloudHome: boolean;
  /** The one-on-one request a conversation's turns answer (index.ts directRequestOwners). */
  directRequest(threadId: string): CloudOwnerTurn["request"];
  threadStarter(threadId: string): string | undefined;
  ownerPerson(person: string | undefined): boolean;
  cardAnswerer: CloudOwnerTurn["cardAnswerer"];
  activeRoutineRun(threadId: string): RoutineRun | null;
  ownerStartedRun(runId: string): boolean;
  routineRunIsOwners(run: RoutineRun, botId: string, threadId: string): boolean;
  routines(): Pick<RoutineManager, "listRoutines"> | null;
  routineAuthors: { authored(id: string, routine: Routine): boolean } | null;
}

export function createCloudOwnerTurns(deps: CloudOwnerTurnsDeps) {
  const { store } = deps;
  /** Each room member turn's generation, while its run lasts: the harness's own record of which line started it. */
  const roomTurnOperations = new Map<string, RoomRun>();

  /** A room member turn's request: the line its run answers, for this generation alone, stopped once the run is. */
  function roomTurnRequest(generation: string): CloudOwnerTurn["request"] {
    const operation = roomTurnOperations.get(generation);
    return operation?.requestMessageId ? { messageId: operation.requestMessageId, generations: new Set([generation]), stopped: operation.cancelled } : undefined;
  }

  function cloudOwnerTurn(capability: Turn): CloudOwnerTurn {
    return {
      request: store.groupByThread(capability.threadId) ? roomTurnRequest(capability.generation) : deps.directRequest(capability.threadId),
      generation: capability.generation,
      thread: store.messagesFor(capability.threadId),
      starters: cloudThreadStarters(capability.threadId),
      reportsFromOthers: store.messagesFor(capability.threadId).some(cloudReportFromOthers),
      botOpened: cloudBotOpened(capability.threadId),
      ownerPerson: deps.ownerPerson,
      cardAnswerer: deps.cardAnswerer,
      routineRun: () => {
        const run = deps.activeRoutineRun(capability.threadId);
        if (!run || run.threadId !== capability.threadId || (ranApart(run) && store.taskByThread(capability.botId, capability.threadId)?.routineRunId !== run.id)) return null;
        return {
          triggerSource: run.triggerSource ?? (run.manual ? "manual" : "schedule"),
          ownerStarted: deps.ownerStartedRun(run.id),
          ownerAuthored: deps.routineRunIsOwners(run, capability.botId, capability.threadId),
        };
      },
    };
  }

  /** A bot opened this conversation (a hand-off's work thread, one a bot started itself, a Chief's notices). */
  function cloudBotOpened(threadId: string): boolean {
    const bot = store.botByThread(threadId);
    return Boolean(bot && store.taskByThread(bot.id, threadId)?.openedBy);
  }

  function cloudThreadStarters(threadId: string): (string | undefined)[] {
    const room = store.groupByThread(threadId);
    return [deps.threadStarter(threadId), ...(room && room.threadId !== threadId ? [deps.threadStarter(room.threadId)] : [])];
  }

  /** On a Cloud home a turn that acts for the owner reads only the owner's own conversations. */
  function cloudOwnerView(capability: Turn): boolean {
    return deps.cloudHome && ownerTurnRefusal(cloudOwnerTurn(capability)) === null;
  }

  function cloudReportFromOthers(line: Message): boolean {
    if (line.webhookPost) return true;
    const routineId = line.automation?.routineId ?? (line.kind === "routine.run" ? line.routineRun?.routineId : undefined);
    if (!routineId) return false;
    // An outside event's run belongs to no routine, so its words are never the owner's.
    const routine = deps.routines()?.listRoutines().find((candidate) => candidate.id === routineId);
    return !routine || deps.routineAuthors?.authored(routine.id, routine) !== true;
  }

  return {
    cloudOwnerTurn, cloudThreadStarters, cloudBotOpened, cloudOwnerView, cloudReportFromOthers,
    /** A room member turn of this run started: its generation acts for the line the run answers. */
    roomTurnStarted(generation: string, run: RoomRun): void { roomTurnOperations.set(generation, run); },
    /** The run ended: none of its turn generations act for anyone any more. */
    roomTurnEnded(run: RoomRun): void { for (const [generation, owner] of roomTurnOperations) if (owner === run) roomTurnOperations.delete(generation); },
    /** The run a room member turn generation belongs to, while it lasts (server/host/acting-person.ts reads whom it acts for). */
    roomRun: (generation: string): RoomRun | undefined => roomTurnOperations.get(generation),
  };
}
