// @vitest-environment happy-dom
// The island only reflects what happens out of sight: switching chats in the app, or a bot the person is watching there,
// never changes it, and quick changes coalesce into one.
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Bot, Message } from "@/state/store";
import { resetTurnLive, turnLive } from "@/state/turn-status";
import { attention } from "./seen";
import { SETTLE_MS, useSteady } from "./shared";
import { ambientSnapshot, type Watch } from "./summary";

let at = 0;
const message = (fields: Partial<Message>): Message => ({ id: `m${++at}`, at, role: "bot", kind: "text", ...fields }) as Message;
const bot = (id: string, fields: Partial<Bot> = {}): Bot => ({ id, name: id, color: "blue", threadId: `t-${id}`, messages: [], busy: false, unread: false, ...fields }) as unknown as Bot;
/** What the compact island and the dock's sliver go by. */
const glance = (bots: Bot[], watch: Watch) => attention(ambientSnapshot(bots, [], turnLive, "en", watch).bots, new Set()).map((entry) => `${entry.id}:${entry.status}`);

afterEach(() => { resetTurnLive(); vi.useRealTimers(); document.body.innerHTML = ""; });

describe("a calm island", () => {
  it("ignores the bot whose chat is open in the focused app, and switching chats changes nothing", () => {
    const watch: Watch = { selectedId: "nova", focused: true, watched: new Map() };
    const nova = bot("nova", { busy: true, turnStartedAt: 100, messages: [message({ role: "user", text: "Find flights" })] } as Partial<Bot>);
    const rivet = bot("rivet");
    const watching = glance([nova, rivet], watch);
    expect(watching).toEqual(["nova:idle", "rivet:idle"]);
    // to another chat, and back: the island sees the very same
    expect(glance([nova, rivet], { ...watch, selectedId: "rivet" })).toEqual(watching);
    expect(glance([nova, rivet], { ...watch, selectedId: "nova" })).toEqual(watching);
    // nova's watched turn finishing, while still open and focused, is no news either
    const replied = bot("nova", { unread: true, messages: [message({ text: "Booked." })] });
    expect(glance([replied, rivet], watch)).toEqual(watching);
  });

  it("shows what happens out of sight: another bot's news, or anything while the app is in the background", () => {
    const watch: Watch = { selectedId: "rivet", focused: true, watched: new Map() };
    const nova = bot("nova", { busy: true, turnStartedAt: 100, messages: [message({ role: "user", text: "Find flights" })] } as Partial<Bot>);
    expect(glance([nova], watch)).toEqual(["nova:working"]);
    expect(glance([nova], { selectedId: "nova", focused: false, watched: new Map() })).toEqual(["nova:working"]);
    // a new turn after the watched one is news again once the person looks away
    const background = { selectedId: "nova", focused: true, watched: new Map() };
    glance([nova], background);
    const next = bot("nova", { busy: true, turnStartedAt: 900, messages: [message({ role: "user", text: "And hotels" })] } as Partial<Bot>);
    expect(glance([next], { ...background, selectedId: "rivet" })).toEqual(["nova:working"]);
  });

  it("ignores a bot the person chats with from the dock's card, even with the app in the background", () => {
    const watch: Watch = { selectedId: "rivet", focused: false, watched: new Map() };
    const viewing = { botId: "nova", limit: 60 };
    const glanceViewing = (bots: Bot[], view: typeof viewing | null) => attention(ambientSnapshot(bots, [], turnLive, "en", watch, view).bots, new Set()).map((entry) => `${entry.id}:${entry.status}`);
    const asked = message({ role: "user", text: "Find flights" });
    const nova = bot("nova", { busy: true, turnStartedAt: 100, messages: [asked] } as Partial<Bot>);
    expect(glanceViewing([nova], viewing)).toEqual(["nova:idle"]);
    // its reply landing while the card still shows it is no news for the notch either
    const replied = bot("nova", { unread: true, messages: [asked, message({ text: "Booked." })] });
    expect(glanceViewing([replied], viewing)).toEqual(["nova:idle"]);
    // and it stays quiet once the card goes, until something new happens
    expect(glanceViewing([replied], null)).toEqual(["nova:idle"]);
    const again = bot("nova", { busy: true, turnStartedAt: 900, messages: [asked, message({ role: "user", text: "And hotels" })] } as Partial<Bot>);
    expect(glanceViewing([again], null)).toEqual(["nova:working"]);
  });

  it("coalesces quick changes into one, and shows a change only once it has held", async () => {
    vi.useFakeTimers();
    const seen: string[] = [];
    let value = "idle";
    const Probe = () => { seen.push(useSteady(value)); return null; };
    const root = createRoot(document.body.appendChild(document.createElement("div")));
    await act(async () => root.render(createElement(Probe)));
    for (const next of ["thinking", "working", "talking", "working"]) {
      value = next;
      await act(async () => { root.render(createElement(Probe)); vi.advanceTimersByTime(SETTLE_MS / 4); });
    }
    expect(new Set(seen)).toEqual(new Set(["idle"]));
    await act(async () => { vi.advanceTimersByTime(SETTLE_MS); });
    expect(seen.at(-1)).toBe("working");
    expect(new Set(seen)).toEqual(new Set(["idle", "working"]));
    await act(async () => root.unmount());
  });
});
