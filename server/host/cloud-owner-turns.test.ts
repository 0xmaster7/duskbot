import { describe, expect, it } from "vitest";
import { createCloudOwnerTurns } from "./cloud-owner-turns.ts";

const OWNER = "p_owner";
const turn = { botId: "b1", threadId: "t1", generation: "g1" };
const own = { id: "m1", role: "user", sender: { id: OWNER } };
const webhookPost = { id: "w1", role: "bot", webhookPost: true };

function owners({ lines = [own] as Record<string, unknown>[], room = false, openedBy = undefined as object | undefined } = {}) {
  const host = createCloudOwnerTurns({
    store: {
      groupByThread: () => (room ? { threadId: "t1" } : undefined),
      messagesFor: () => lines,
      botByThread: () => ({ id: "b1" }),
      taskByThread: () => ({ threadId: "t1", ...(openedBy ? { openedBy } : {}) }),
    } as never,
    cloudHome: true,
    directRequest: () => ({ messageId: "m1", generations: new Set(["g1"]) }),
    threadStarter: () => undefined,
    ownerPerson: (person) => person === OWNER,
    cardAnswerer: () => undefined,
    activeRoutineRun: () => null,
    ownerStartedRun: () => false,
    routineRunIsOwners: () => false,
    routines: () => null,
    routineAuthors: null,
  });
  if (room) host.roomTurnStarted("g1", { requestMessageId: "m1", cancelled: false } as never);
  return host;
}

describe("which turns on a Cloud home act for its owner (server/host/cloud-owner-turns.ts)", () => {
  it("the owner's own clean conversation does, and reads only the owner's conversations", () => {
    expect(owners().cloudOwnerView(turn)).toBe(true);
  });
  it("a conversation a bot opened, or one a webhook posted in, does not", () => {
    const opened = owners({ openedBy: { botId: "b2", name: "CoS", kind: "work", at: 1 } });
    expect(opened.cloudBotOpened("t1")).toBe(true);
    expect(opened.cloudOwnerView(turn)).toBe(false);
    expect(owners().cloudBotOpened("t1")).toBe(false);
    expect(owners({ lines: [own, webhookPost] }).cloudOwnerView(turn)).toBe(false);
  });
  it("a room member turn acts for the line its run answers only while the run lasts", () => {
    const host = owners({ room: true });
    const run = host.roomRun("g1")!;
    expect(host.cloudOwnerView(turn)).toBe(true);
    host.roomTurnEnded(run);
    expect(host.roomRun("g1")).toBeUndefined();
    expect(host.cloudOwnerView(turn)).toBe(false);
  });
});
