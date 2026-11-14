import { describe, expect, it } from "vitest";
import { failedReplyReason } from "./failed-reply-reason.ts";
import { serverLine } from "./server-lines.ts";

describe("failed reply reason", () => {
  it("reads the free backup's no-reply and free-limit lines as no AI connected", () => {
    expect(failedReplyReason(serverLine(undefined, "server.freeModel.noReply"), {})).toBe("no_ai");
    expect(failedReplyReason(serverLine(undefined, "server.freeModel.limit"), {})).toBe("no_ai");
    expect(failedReplyReason("API Error: 529 Overloaded", {})).toBe("overloaded");
  });
});
