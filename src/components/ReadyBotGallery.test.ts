// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const opened = vi.hoisted(() => ({ props: null as null | { readyBotId?: string; onClose?: () => void; onCreated?: (bot: { id: string }) => void }, dispatch: vi.fn(), state: { config: null, bots: [] } as { config: { botLimit?: number } | null; bots: object[] } }));
vi.mock("./lazy-screens", () => ({
  NewBotDialog: (props: NonNullable<typeof opened.props>) => { opened.props = props; return null; },
}));
const made = vi.hoisted(() => ({ defaults: { profile: {}, memory: {}, skills: [], routines: [] } as { profile: Record<string, unknown>; memory: object; skills: unknown[]; routines: unknown[] }, create: vi.fn() }));
vi.mock("@/state/store", () => ({
  useStore: () => ({ dispatch: opened.dispatch, state: opened.state }),
  api: vi.fn(async () => ({ defaults: made.defaults, suggestedName: "Nova", modelSelection: { instanceId: "", model: "" } })),
}));
vi.mock("@/lib/create-configured-bot", () => ({ createConfiguredBot: made.create }));
vi.mock("@/lib/new-bot", async (actual) => ({ ...await actual<typeof import("@/lib/new-bot")>(), announceNewBot: vi.fn() }));

const { ReadyBotGallery } = await import("./ReadyBotGallery");
const { READY_BOTS } = await import("@/lib/ready-bots");

let root: Root;
let host: HTMLElement;
const onDialog = vi.fn();
const onAdded = vi.fn();

function render(search = "") {
  flushSync(() => root.render(createElement(ReadyBotGallery, { search, onDialog, onAdded })));
}
const cards = () => [...host.querySelectorAll("[data-ready-bot]")].map((card) => card.getAttribute("data-ready-bot"));
const button = (name: string) => [...host.querySelectorAll("button")].find((candidate) =>
  candidate.textContent === name || candidate.getAttribute("aria-label") === name)!;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  opened.props = null;
  opened.state = { config: null, bots: [] };
  opened.dispatch.mockReset();
  made.defaults = { profile: {}, memory: {}, skills: [], routines: [] };
  made.create.mockReset();
  made.create.mockImplementation(async (draft: { bot: { name: string } }) => ({ bot: { id: "new-bot", name: draft.bot.name }, warnings: [] }));
  onDialog.mockClear();
  onAdded.mockClear();
});
afterEach(() => { flushSync(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

describe("ready-made bots gallery", () => {
  it("shows every ready-made bot with its own Add button", () => {
    render();
    expect(cards()).toEqual(READY_BOTS.map((bot) => bot.id));
    const labels = [...host.querySelectorAll("button[aria-label^='Add ']")].map((add) => add.getAttribute("aria-label"));
    expect(new Set(labels).size).toBe(READY_BOTS.length);
    expect(host.querySelector(`[data-ready-bot="${READY_BOTS[0]!.id}"]`)?.getAttribute("title")).toBe(READY_BOTS[0]!.description);
  });

  it("narrows to a category and back to all", () => {
    render();
    flushSync(() => button("Design").click());
    expect(cards()).toEqual(["design-critic"]);
    expect(button("Design").getAttribute("aria-pressed")).toBe("true");
    flushSync(() => button("All").click());
    expect(cards()).toHaveLength(READY_BOTS.length);
  });

  it("follows the Templates search and hides itself when nothing matches", () => {
    render("plant");
    expect(cards()).toEqual(["plant-care"]);
    render("no bot is called this");
    expect(host.querySelector("section")).toBeNull();
  });

  it("makes the chosen bot in one click, filled in from it", async () => {
    render();
    flushSync(() => button("Add Fern, Plant care log").click());
    await vi.waitFor(() => expect(onAdded).toHaveBeenCalledWith({ id: "new-bot", name: "Fern" }));
    expect(opened.props).toBeNull();
    expect(onDialog).not.toHaveBeenCalled();
    expect(opened.dispatch).toHaveBeenCalledWith({ type: "botCreationPending", on: true });
    expect(opened.dispatch).toHaveBeenLastCalledWith({ type: "botCreationPending", on: false });
  });

  it("opens the review when the bot would approve its own work on this computer, and steps Templates aside", async () => {
    made.defaults = { profile: { approvalMode: "auto", computer: "local" }, memory: {}, skills: [], routines: [] };
    render();
    flushSync(() => button("Add Fern, Plant care log").click());
    await vi.waitFor(() => expect(opened.props?.readyBotId).toBe("plant-care"));
    expect(made.create).not.toHaveBeenCalled();
    expect(onDialog).toHaveBeenLastCalledWith(true);
    opened.props!.onCreated!({ id: "new-bot" });
    expect(onAdded).toHaveBeenCalledWith({ id: "new-bot" });
    expect(onDialog).toHaveBeenLastCalledWith(false);
  });

  it("on a paired device, which cannot read the host's defaults, makes the bot at once", () => {
    vi.stubGlobal("ogb", { remoteClient: { active: true } });
    render();
    flushSync(() => button("Add Fern, Plant care log").click());
    expect(opened.props).toBeNull();
    expect(opened.dispatch).toHaveBeenCalledWith({ type: "newBot", onCreated: onAdded });
  });

  it("gives Templates its keys back when the review is closed without creating", async () => {
    made.defaults = { profile: { approvalMode: "auto", computer: "local" }, memory: {}, skills: [], routines: [] };
    render();
    flushSync(() => button("Add Echo, Humanizer").click());
    await vi.waitFor(() => expect(opened.props).not.toBeNull());
    flushSync(() => opened.props!.onClose!());
    expect(onDialog).toHaveBeenLastCalledWith(false);
    expect(onAdded).not.toHaveBeenCalled();
  });

  it("at Starter's limit opens the upgrade popup instead of a form to fill in", async () => {
    const { botLimitShown, closeBotLimit } = await import("@/lib/bot-limit");
    opened.state = { config: { botLimit: 5 }, bots: Array.from({ length: 5 }, () => ({})) };
    render();
    flushSync(() => button("Add Fern, Plant care log").click());
    expect(opened.props).toBeNull();
    expect(made.create).not.toHaveBeenCalled();
    expect(botLimitShown()).toBe(true);
    closeBotLimit();
  });
});
