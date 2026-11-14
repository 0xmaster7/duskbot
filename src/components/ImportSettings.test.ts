// @vitest-environment happy-dom
// Settings → general → bring in from other apps: the first run's bring step (BringIn), without the funnel around it.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import { bringRunNow, resetBringRunForTests } from "@/lib/first-run-import";
import { GROK_EXPORT_FORMAT } from "../../shared/grok-import";
import type { SetupDetection } from "../../shared/setup-import";

const f = vi.hoisted(() => ({ state: {} as Record<string, unknown>, dispatch: vi.fn(), api: vi.fn() }));
vi.mock("@/state/store", () => ({ useStore: () => ({ state: f.state, dispatch: f.dispatch }), api: f.api }));
vi.mock("@/state/api", () => ({ api: f.api }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/components/Avatar", () => ({ BotAvatar: () => null, MausAvatar: () => null }));
vi.mock("@/lib/default-bot", async (original) => ({ ...(await original<typeof import("@/lib/default-bot")>()), useViewerEmail: () => null }));
const { ImportSettings } = await import("./ImportSettings");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const maus = { id: "maus", name: "Dusk", defaultBot: {}, messages: [] };
const molty = { source: "openclaw", app: "OpenClaw", where: "~/.openclaw", channels: [], unreadable: [], bots: [{
  name: "Molty", title: "", description: "", instructions: "Be helpful.", memories: ["Sam's sister is Ana."], userFacts: [], skills: [], routines: [], apps: [],
}] };
const grokFile = { name: "grok-bot-export-drew.json", modifiedAt: 1, text: JSON.stringify({ format: GROK_EXPORT_FORMAT, bots: [{ name: "Drew", instructions: "Hi." }] }) };
const SETUP: SetupDetection = { skills: [{ name: "pdf", source: "claudeCode" }], tools: [] };

let host: HTMLDivElement, root: Root;
const text = () => host.textContent ?? "";
const button = (label: string) => [...host.querySelectorAll("button")].find((node) => node.textContent === label);
const settle = async () => { for (let i = 0; i < 8; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };
const client = (detection: SetupDetection) => ({
  detect: vi.fn(async () => detection),
  apply: vi.fn(async () => ({ skills: { added: ["pdf"], present: [], skipped: [], filesLeftOut: 0, review: [] }, tools: { added: [], present: [], skipped: [] }, instructions: [] })),
});
async function show(options: { local?: boolean; detection?: SetupDetection } = {}) {
  if (options.local !== false) vi.stubGlobal("duskDesktop", { remoteClient: { active: false } });
  const setup = client(options.detection ?? SETUP);
  await act(async () => root.render(createElement(ImportSettings, { client: setup })));
  await settle();
  return setup;
}

beforeEach(() => {
  setLocale("en");
  resetBringRunForTests();
  f.state = { bots: [maus], config: { profile: {} } };
  f.dispatch = vi.fn();
  f.api.mockReset();
  f.api.mockImplementation(async (path: string, init?: { body?: string; method?: string }) => {
    if (path === "/api/setup-import/bots") return { apps: [molty] };
    if (path.startsWith("/api/setup-import/grok")) return { files: [grokFile], bots: ["Drew", "Eggbot"] };
    if (path === "/api/mcp/servers") return { servers: [] };
    if (path.startsWith("/api/teams/import")) return { bots: [{ id: `id-${JSON.parse(init!.body!).package.name}`, name: JSON.parse(init!.body!).package.name }], routines: [] };
    return {};
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("Settings → bring in from other apps", () => {
  it("is the first run's one flow: what this computer holds, Grok bot's saved files included, and the prompt for AIs online, with none of the old rows", async () => {
    await show();
    expect(f.api.mock.calls.map(([path]) => path), "Settings may read Downloads, unlike the first run").toContain("/api/setup-import/grok");
    expect([...host.querySelectorAll("[data-bring-find]")].map((row) => [row.getAttribute("data-bring-find"), row.getAttribute("aria-checked")]))
      .toEqual([["bots:openclaw", "true"], ["bots:grok-bot", "true"]]);
    expect(text()).toContain("Molty");
    expect(text()).toContain("Drew");
    expect(host.querySelector("[data-bring-online]")?.textContent).toBe("from Grok bot, ChatGPT, Claude or Gemini");
    expect(host.querySelector("[data-bring-grok]")?.textContent, "a Grok bot bot with nothing saved yet goes through the prompt").toContain("Eggbot in Grok bot");
    for (const old of ["move from Grok bot", "start import", "copy prompt", "look for bots"]) expect(button(old), old).toBeUndefined();
    expect(host.querySelector("[data-import-section=grok], [data-import-section=notes], [data-import-section=apps], [data-import-section=bots]")).toBeNull();
    expect(host.querySelector("[data-bring-skip], [data-bring-next]"), "no funnel buttons").toBeNull();
  });

  it("brings the chosen in on one press, says how it went on the page, and locks what was brought", async () => {
    const setup = await show();
    await act(async () => { host.querySelector<HTMLButtonElement>('[data-bring-find="bots:grok-bot"]')!.click(); });
    await act(async () => { button("bring it in")!.click(); });
    await settle();
    expect(setup.apply).toHaveBeenCalledWith({ skills: true, tools: true, instructions: true, sources: ["claudeCode"] });
    const imported = f.api.mock.calls.filter(([path]) => String(path).startsWith("/api/teams/import")).map(([, init]) => JSON.parse(init.body).package.name);
    expect(imported, "only the chosen app's bots").toEqual(["Molty"]);
    expect(host.querySelector("[data-bring-run]")?.textContent).toBe("Brought in 1 bot and 1 skill.");
    expect(button("bring it in")).toBeUndefined();
    expect(host.querySelector("[data-bring-find]")?.getAttribute("aria-disabled")).toBe("true");
  });

  it("forgets a bringing in that finished before the page opened", async () => {
    await show();
    await act(async () => { button("bring it in")!.click(); });
    await settle();
    expect(bringRunNow().kind).toBe("done");
    await act(async () => root.unmount());
    root = createRoot(host);
    await show();
    expect(bringRunNow().kind).toBe("idle");
    expect(button("bring it in")).toBeTruthy();
  });

  it("away from this computer's own desktop app, reads nothing here and offers the prompt straight away", async () => {
    await show({ local: false });
    expect(f.api.mock.calls.filter(([path]) => String(path).startsWith("/api/setup-import"))).toEqual([]);
    expect(host.querySelector("[data-bring-looking]")).toBeNull();
    expect(host.querySelector("[data-bring-find]")).toBeNull();
    expect(host.querySelector("[data-bring-prompt] pre")?.textContent).toContain("dusk-bot-notes");
    expect(button("copy the prompt")).toBeTruthy();
    expect(button("bring it in")).toBeUndefined();
  });

  it("takes the notes another AI wrote when they are pasted on the page, and says so there", async () => {
    await show({ local: false });
    const paste = new Event("paste", { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(paste, "clipboardData", { value: { getData: () => JSON.stringify({ format: "dusk-bot-notes", version: 2, from: "ChatGPT", about_me: { basics: ["I live in Pune."] } }) } });
    await act(async () => { host.dispatchEvent(paste); });
    expect(paste.defaultPrevented, "nothing behind gets it").toBe(true);
    await settle();
    expect(host.querySelector("[data-bring-notes]")).not.toBeNull();
    expect(host.querySelector("[data-bring-notes]")?.textContent).toMatch(/ChatGPT|notes/);
  });
});
