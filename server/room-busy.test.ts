import { describe, expect, it } from "vitest";

import { roomBusyError, roomBusyReason, type RoomBusyInput } from "./room-busy.ts";

const names: Record<string, string> = { ada: "Ada", iris: "Iris", rex: "Rex" };
const room = (over: Partial<RoomBusyInput> = {}): RoomBusyInput => ({
  threads: [{ threadId: "main" }, { threadId: "t2", title: "Launch plan" }],
  speakers: [], operations: [], busyBotId: null, openCards: [], name: (id) => names[id] ?? "another bot", ...over,
});

describe("roomBusyReason", () => {
  it("lets a bot change the room it is answering in", () => {
    const own = room({ speakers: [{ threadId: "main", botId: "ada", name: "Ada" }], operations: [{ threadId: "main", botIds: ["ada"] }], busyBotId: "ada" });
    expect(roomBusyReason({ ...own, caller: { botId: "ada", threadId: "main" } })).toBeNull();
  });

  it("still refuses a person or another bot while that turn runs, naming it", () => {
    const own = room({ speakers: [{ threadId: "main", botId: "ada", name: "Ada" }], operations: [{ threadId: "main", botIds: ["ada"] }], busyBotId: "ada" });
    expect(roomBusyReason(own)).toBe("Ada is answering in this room right now");
    expect(roomBusyReason({ ...own, caller: { botId: "iris", threadId: "main" } })).toBe("Ada is answering in this room right now");
  });

  it("refuses the caller when another bot works in the same conversation", () => {
    const shared = room({ speakers: [{ threadId: "main", botId: "ada", name: "Ada" }], operations: [{ threadId: "main", botIds: ["ada", "iris", "rex"] }] });
    expect(roomBusyReason({ ...shared, speakers: [], caller: { botId: "ada", threadId: "main" } })).toBe("Iris and Rex are lined up to answer in this room");
  });

  it("refuses the caller's own turn in another of the room's threads", () => {
    const elsewhere = room({ speakers: [{ threadId: "t2", botId: "ada", name: "Ada" }], busyBotId: "ada" });
    expect(roomBusyReason({ ...elsewhere, caller: { botId: "ada", threadId: "main" } })).toBe(`Ada is answering in the room's thread "Launch plan" right now`);
    expect(roomBusyReason(room({ operations: [{ threadId: "t2", botIds: [] }] }))).toBe(`a turn is starting in the room's thread "Launch plan"`);
  });

  it("names a question card waiting on the person", () => {
    expect(roomBusyReason(room({ openCards: ["t2"], caller: { botId: "ada", threadId: "main" } })))
      .toBe(`a question card in the room's thread "Launch plan" is waiting for the person's answer`);
    expect(roomBusyError("Iris is answering in this room right now")).toMatch(/^this room is busy: Iris is answering in this room right now\. /);
  });
});
