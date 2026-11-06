// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";

import { loadLocale } from "@/lib/i18n";
import type { Bot, Message } from "@/state/store";
import { RoomWorkingLines, roomWorkingIds } from "./RoomWorkingLines";

await loadLocale("en");

const bot = (id: string, name: string) => ({
  id, name, color: "green", threadId: id, title: "", description: "", notifications: true, unread: false, messages: [],
  modelSelection: { instanceId: "test", model: "m" },
}) as Bot;
const members = [bot("echo", "Echo"), bot("nova", "Nova"), bot("moss", "Moss")];

describe("who works in a room", () => {
  it("names the speaker, every parallel turn and a member whose tool call is out, once each", () => {
    const toolCall = { id: "a", role: "bot", kind: "activity", at: 1, from: { botId: "moss", name: "Moss", color: "green" }, tool: { name: "Bash", input: "{}" } } as Message;
    expect(roomWorkingIds({ threadId: "t", busyBotId: "echo", busyBotIds: ["echo", "nova"] }, toolCall)).toEqual(["echo", "nova", "moss"]);
    expect(roomWorkingIds({ threadId: "t", busyBotId: null }, undefined)).toEqual([]);
  });
});

describe("the room's working lines", () => {
  const draw = (workingIds: string[], speakerVisible = true) => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    flushSync(() => root.render(createElement(RoomWorkingLines, {
      group: { id: "room", turnStartedAt: 1 },
      members,
      workingIds,
      speaker: { bot: members[0], visible: speakerVisible, markState: "streaming", phrases: ["Typing…"], phase: "friendly:chat.typing", since: null },
      slot: true,
    })));
    return { host, done: () => { flushSync(() => root.unmount()); host.remove(); } };
  };

  it("stacks one quiet line per working bot, each with its name, and no steps to unfold", () => {
    const { host, done } = draw(["echo", "nova", "moss"]);
    const lines = [...host.querySelectorAll("[data-room-working-line]")].map((line) => line.getAttribute("data-room-working-line"));
    expect(lines).toEqual(["Echo", "Nova", "Moss"]);
    expect([...host.querySelectorAll("[data-turn-name]")].map((name) => name.textContent)).toEqual(["Echo", "Nova", "Moss"]);
    expect(host.querySelector("button[aria-expanded]")).toBeNull();
    expect(host.querySelector("[data-turn-quiet], .tabular-nums")).toBeNull();
    expect(host.querySelector(".turn-status-slot")).not.toBeNull();
    done();
  });

  it("keeps the slot when nobody works", () => {
    const { host, done } = draw([], false);
    expect(host.querySelector("[data-room-working-line]")).toBeNull();
    expect(host.querySelector(".turn-status-slot")).not.toBeNull();
    done();
  });
});
