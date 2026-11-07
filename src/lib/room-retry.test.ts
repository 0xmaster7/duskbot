import { describe, expect, it } from "vitest";
import { roomRetryRequest, roomRetryText } from "./room-retry";

const members = [{ id: "q", name: "Quill" }, { id: "e", name: "Echo" }, { id: "r", name: "Rivet" }, { id: "n", name: "Nova" }];

describe("roomRetryText", () => {
  it("asks only the members that didn't answer, dropping the tags of those that did", () => {
    expect(roomRetryText("@Quill @Echo @Rivet status check", members, ["e", "r"])).toBe("@Echo @Rivet status check");
    expect(roomRetryText("status check for @Quill and @Echo", members, ["e"])).toBe("status check for and @Echo");
  });

  it("tags a member the line never named, in front", () => {
    expect(roomRetryText("Get the launch ready", members, ["n"])).toBe("@Nova Get the launch ready");
    expect(roomRetryText("@Quill draft it", members, ["e", "r"])).toBe("@Echo @Rivet draft it");
  });

  it("leaves an address, a longer name and other words alone", () => {
    expect(roomRetryText("mail quill@example.com, @Quillton too", members, ["e"])).toBe("@Echo mail quill@example.com, @Quillton too");
  });
});

describe("roomRetryRequest", () => {
  it("finds the person's message the failed turn answered", () => {
    const transcript = [
      { id: "u1", role: "user" as const, kind: "text" as const, text: "@Echo hi" },
      { id: "b1", role: "bot" as const, kind: "activity" as const },
    ];
    expect(roomRetryRequest(transcript, 1)).toEqual({ messageId: "u1", text: "@Echo hi", mode: "chat" });
  });
});
