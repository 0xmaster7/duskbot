import { describe, expect, it } from "vitest";

import type { Message } from "@/state/store";
import { awaitedMemberId } from "./turn-tail";

const msg = (m: Partial<Message>): Message => ({ id: "m1", role: "bot", kind: "text", at: 1, ...m });

describe("awaitedMemberId", () => {
  const waitChip = msg({
    kind: "activity",
    from: { botId: "b", name: "B", color: "blue" },
    tool: { name: "B is finishing another conversation — will reply here when free", spoken: "B is finishing another conversation" },
  });

  it("names the member whose wait chip is the newest thing in a working room with no speaker", () => {
    expect(awaitedMemberId(true, null, waitChip)).toBe("b");
    expect(awaitedMemberId(true, undefined, waitChip)).toBe("b");
  });

  it("stands down once someone has the floor or the room stops working", () => {
    expect(awaitedMemberId(true, "a", waitChip)).toBeUndefined();
    expect(awaitedMemberId(false, null, waitChip)).toBeUndefined();
    expect(awaitedMemberId(undefined, null, waitChip)).toBeUndefined();
  });

  it("ignores a settled chip and any other tail", () => {
    expect(awaitedMemberId(true, null, { ...waitChip, tool: { ...waitChip.tool!, ok: true } })).toBeUndefined();
    expect(awaitedMemberId(true, null, { ...waitChip, tool: { ...waitChip.tool!, ok: false } })).toBeUndefined();
    expect(awaitedMemberId(true, null, msg({ from: { botId: "b", name: "B", color: "blue" } }))).toBeUndefined();
    expect(awaitedMemberId(true, null, msg({ kind: "goal.run" }))).toBeUndefined();
    expect(awaitedMemberId(true, null, undefined)).toBeUndefined();
  });
});
