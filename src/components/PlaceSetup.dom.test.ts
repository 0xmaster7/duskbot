// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";

const fixture = vi.hoisted(() => ({ dispatch: vi.fn() }));
vi.mock("@/components/Avatar", () => ({ MausAvatar: () => createElement("span", { "data-mascot": "" }) }));
vi.mock("@/state/store", async (original) => ({
  ...await original<typeof import("@/state/store")>(),
  useStore: () => ({ state: { bots: [], config: {} }, dispatch: fixture.dispatch }),
}));
vi.mock("./CreateBotDialog", () => ({ openCreateBot: vi.fn() }));
import { EMPTY_VIEW, closeAddVps, VPS_STEP_IDS, type VpsLinkBridge, type VpsLinkView } from "@/lib/vps-link";
import { PlaceSetup } from "./PlaceSetup";
import { MacEmptyMain, useMacEmptyPrompt } from "./MacEmptyMain";

const SERVER = { id: "vps-1", name: "my-vps", origin: "https://vps.example.com" };
function fakeLink() {
  let view: VpsLinkView = EMPTY_VIEW;
  const listeners = new Set<(view: VpsLinkView) => void>();
  const bridge = {
    state: vi.fn(async () => view),
    start: vi.fn(async () => (view = { ...EMPTY_VIEW, stage: "command", command: "curl -fsSL https://link.example/i/abc | sh", expiresAt: Date.now() + 25 * 60_000 })),
    reset: vi.fn(async () => (view = EMPTY_VIEW)),
    open: vi.fn(async () => {}),
    where: vi.fn(async () => ({ place: "vps" as const, server: SERVER })),
    moveBack: vi.fn(async () => ({ ok: true as const })),
    onChange: vi.fn((callback: (view: VpsLinkView) => void) => { listeners.add(callback); return () => listeners.delete(callback); }),
  } as unknown as VpsLinkBridge;
  const emit = async (next: VpsLinkView) => { view = next; await act(async () => { for (const listen of listeners) listen(next); }); await settle(); };
  return { bridge, emit };
}

let host: HTMLDivElement, root: Root;
const settle = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };
const q = <T extends Element = HTMLElement>(selector: string) => document.querySelector<T>(selector);
const byText = (label: string) => [...document.querySelectorAll("button")].find((item) => item.textContent?.trim() === label);
const click = async (target: Element | null | undefined) => { expect(target).toBeTruthy(); await act(async () => { (target as HTMLElement).click(); }); await settle(); };
const type = async (input: HTMLInputElement, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  setLocale("en");
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); closeAddVps(); host.remove(); document.body.innerHTML = ""; vi.unstubAllGlobals(); vi.clearAllMocks(); });

it("adding a server by one line shows the line, then each step live, then opens the server it linked", async () => {
  const link = fakeLink();
  const workspaces = { add: vi.fn() };
  vi.stubGlobal("duskDesktop", { vpsLink: link.bridge, cloudAccount: {}, workspaces });
  const onClose = vi.fn();
  await act(async () => { root.render(createElement(PlaceSetup, { onClose })); });
  await settle();
  expect(q("[data-place-setup=choose]")).toBeTruthy();
  await click(q("[data-place-add-choice=server]"));
  expect(q("[data-setup-method=relay]")?.textContent).toContain("recommended");
  await click(q("[data-setup-method=relay]"));
  expect(link.bridge.start).toHaveBeenCalledTimes(1);
  expect(q("[data-setup-command]")?.className, "the whole line shows, wrapped").toContain("[overflow-wrap:anywhere]");
  expect(q("[data-install-phase]")?.getAttribute("data-install-phase")).toBe("waiting");
  expect(q("[data-setup-command]")?.textContent).toContain("curl -fsSL");
  expect(q("li[aria-current=step]")?.textContent).toBe("waiting for your server");

  await link.emit({ ...EMPTY_VIEW, stage: "installing", steps: VPS_STEP_IDS.map((id, index) => ({ id, status: index === 0 ? "running" : "waiting" })) });
  expect(q("[data-install-phase]")?.getAttribute("data-install-phase")).toBe("found");
  await link.emit({ ...EMPTY_VIEW, stage: "installing", steps: VPS_STEP_IDS.map((id, index) => ({ id, status: index < 4 ? "done" : index === 4 ? "running" : "waiting" })) });
  expect(q("[data-install-phase]")?.getAttribute("data-install-phase")).toBe("connecting");
  expect(q("li[aria-current=step]")?.textContent).toContain("setting it up");

  await link.emit({ ...EMPTY_VIEW, stage: "installing", steps: VPS_STEP_IDS.map((id, index) => ({ id, status: index < 4 ? "done" : index === 4 ? "failed" : "waiting", ...(index === 4 ? { log: "Node didn't install." } : {}) })) });
  expect(q("[data-install-phase]")?.getAttribute("data-install-phase")).toBe("failed");
  expect(q("[role=alert]")?.textContent).toContain("Node didn't install.");
  await click(byText("try again"));
  expect(link.bridge.reset).toHaveBeenCalledTimes(1);
  expect(link.bridge.start).toHaveBeenCalledTimes(2);

  await link.emit({ ...EMPTY_VIEW, stage: "linked", server: SERVER, steps: VPS_STEP_IDS.map((id) => ({ id, status: "done" })) });
  expect(q("[data-install-phase]")?.getAttribute("data-install-phase")).toBe("done");
  expect(q("h2")?.textContent).toBe("my-vps is connected");
  expect(q("li")?.textContent, "a finished first step reads as done, not as still waiting").toBe("your server checked in");
  await click(byText("open my-vps"));
  expect(link.bridge.open).toHaveBeenCalledTimes(1);
  expect(onClose).toHaveBeenCalled();
});

it("a step that failed keeps its line to paste again, with a new line as the second choice", async () => {
  const link = fakeLink();
  vi.stubGlobal("duskDesktop", { vpsLink: link.bridge });
  await act(async () => { root.render(createElement(PlaceSetup, { onClose: vi.fn(), start: "install" })); });
  await settle();
  await link.emit({ ...EMPTY_VIEW, stage: "installing", command: "curl -fsSL https://link.example/i/abc | sh", expiresAt: Date.now() + 60_000,
    steps: VPS_STEP_IDS.map((id, index) => ({ id, status: index < 2 ? "done" : index === 2 ? "failed" : "waiting", ...(index === 2 ? { log: "Couldn't install Node." } : {}) })) });
  expect(q("h2")?.textContent).toBe("something got stuck");
  expect(q("h2 + p")?.textContent).toBe("Paste the same line again. It picks up where it stopped.");
  expect(q("[data-setup-command]")?.textContent).toContain("link.example/i/abc");
  expect(byText("try again")).toBeUndefined();
  expect(q("[data-setup-new]")?.className).not.toContain("ui-button-primary");
  expect(q("li[aria-current]")).toBeNull();
  expect(document.body.textContent).toContain("didn't finish");
});

it("arriving with a server linked already makes a new line, so another server can be added", async () => {
  const link = fakeLink();
  vi.stubGlobal("duskDesktop", { vpsLink: link.bridge });
  await link.emit({ ...EMPTY_VIEW, stage: "linked", server: SERVER, steps: VPS_STEP_IDS.map((id) => ({ id, status: "done" })) });
  await act(async () => { root.render(createElement(PlaceSetup, { onClose: vi.fn(), start: "install" })); });
  expect(q("[data-install-phase]")?.getAttribute("data-install-phase"), "never the old server's connected screen").not.toBe("done");
  await settle();
  expect(link.bridge.start).toHaveBeenCalledTimes(1);
  expect(q("[data-install-phase]")?.getAttribute("data-install-phase")).toBe("waiting");
  expect(q("h2")?.textContent).toBe("paste this on your server");
});

it("once linked it goes on to signing in the AI and moving the bots", async () => {
  const link = fakeLink();
  vi.stubGlobal("duskDesktop", { vpsLink: link.bridge });
  const onClose = vi.fn();
  await act(async () => { root.render(createElement(PlaceSetup, { onClose, start: "install" })); });
  await settle();
  await link.emit({ ...EMPTY_VIEW, stage: "linked", server: SERVER, steps: VPS_STEP_IDS.map((id) => ({ id, status: "done" })) });
  expect(q("[data-setup-next]")?.textContent).toBe("sign in to your AI");
  expect(q("[data-setup-next]")?.className).toContain("ui-button-primary");
  const { useAddVpsOpen } = await import("@/lib/vps-link");
  let shown = false;
  function Probe() { shown = useAddVpsOpen(); return null; }
  await click(q("[data-setup-next]"));
  await act(async () => { root.render(createElement(Probe)); });
  expect(onClose).toHaveBeenCalled();
  expect(shown, "the full flow opens on its sign-in").toBe(true);
});

it("a line out of time offers a new one", async () => {
  const link = fakeLink();
  vi.stubGlobal("duskDesktop", { vpsLink: link.bridge });
  await act(async () => { root.render(createElement(PlaceSetup, { onClose: vi.fn(), start: "install" })); });
  await settle();
  await link.emit({ ...EMPTY_VIEW, stage: "command", command: "curl x | sh", expiresAt: Date.now() - 1000 });
  expect(q("[data-install-phase]")?.getAttribute("data-install-phase")).toBe("expired");
  expect(q("h2")?.textContent).toBe("this line ran out of time");
  expect(document.body.textContent).toContain("out of time");
  expect(document.body.textContent).not.toContain("stopped");
  await click(byText("new line"));
  expect(link.bridge.start).toHaveBeenCalledTimes(2);
  expect(link.bridge.reset).toHaveBeenCalledTimes(1);
});

it("every way to connect is one row in order, relay first, with no art", async () => {
  vi.stubGlobal("duskDesktop", { vpsLink: fakeLink().bridge, workspaces: { add: vi.fn() } });
  await act(async () => { root.render(createElement(PlaceSetup, { onClose: vi.fn() })); });
  expect([...document.querySelectorAll("[data-setup-method]")].map((row) => row.getAttribute("data-setup-method")))
    .toEqual(["relay", "tailscale", "tunnel", "domain", "ssh", "address"]);
  expect(q("[data-setup-method] [data-place-art]")).toBeNull();
  for (const row of document.querySelectorAll("[data-setup-method]")) expect(row.querySelectorAll("span.block").length).toBe(1);
});

it("a way by address shows one full command, explains each field, and checks what was typed", async () => {
  const workspaces = { add: vi.fn(async () => true) };
  vi.stubGlobal("duskDesktop", { workspaces });
  const onClose = vi.fn();
  await act(async () => { root.render(createElement(PlaceSetup, { onClose })); });
  await click(q("[data-setup-method=tailscale]"));
  expect(q("[data-setup-command]")?.textContent).toMatch(/^curl -fsSL https:\/\/deb\.nodesource\.com\/setup_24\.x .* npx -y duskbot serve --tailscale$/);
  expect(document.body.textContent).toContain("The https:// address the command prints.");
  expect(document.body.textContent).toContain("The code the command prints");
  await type(q<HTMLInputElement>("[data-setup-address]")!, "http://10.0.0.5:8799");
  await act(async () => { q<HTMLFormElement>("form")!.requestSubmit(); });
  expect(q("[role=alert]")?.textContent).toBe("Use an https:// address. Plain http only works through an SSH tunnel, at http://127.0.0.1.");
  expect(workspaces.add).not.toHaveBeenCalled();
  // a whole pairing link carries its code, so the code field goes
  await type(q<HTMLInputElement>("[data-setup-address]")!, "https://box.tail1.ts.net/pair#code=ABCD-2345-EFGH");
  expect(q("[data-setup-code]")).toBeNull();
  await type(q<HTMLInputElement>("[data-setup-address]")!, "box.tail1.ts.net");
  await type(q<HTMLInputElement>("[data-setup-code]")!, "abcd2345efgh");
  await act(async () => { q<HTMLFormElement>("form")!.requestSubmit(); });
  await settle();
  expect(workspaces.add).toHaveBeenCalledWith("link", "https://box.tail1.ts.net/pair#code=ABCD-2345-EFGH");
  expect(onClose).toHaveBeenCalled();
});

it("an SSH tunnel lands on 8790 here, so this computer's own 8799 is never asked, and only the code is typed", async () => {
  const workspaces = { add: vi.fn(async () => true) };
  vi.stubGlobal("duskDesktop", { workspaces });
  await act(async () => { root.render(createElement(PlaceSetup, { onClose: vi.fn() })); });
  await click(q("[data-setup-method=ssh]"));
  const commands = [...document.querySelectorAll("[data-setup-command]")].map((node) => node.textContent);
  expect(commands[1]).toBe("ssh -N -L 8790:127.0.0.1:8799 you@your-server");
  expect(q("[data-setup-address]")).toBeNull();
  await type(q<HTMLInputElement>("[data-setup-code]")!, "ABCD-2345-EFGH");
  await act(async () => { q<HTMLFormElement>("form")!.requestSubmit(); });
  await settle();
  expect(workspaces.add).toHaveBeenCalledWith("link", "http://127.0.0.1:8790/pair#code=ABCD-2345-EFGH");
});

it("from the rail it offers a new organization and another account under the two choices", async () => {
  const onAccount = vi.fn();
  vi.stubGlobal("duskDesktop", { cloudAccount: {}, workspaces: { add: vi.fn() } });
  await act(async () => { root.render(createElement(PlaceSetup, { onClose: vi.fn(), onAccount, choices: { cloud: true, link: true, address: true, organization: true, account: true } })); });
  expect(q("[data-place-add-choice=cloud]")).toBeTruthy();
  expect(q("[data-place-add-choice=server]")).toBeTruthy();
  await click(q("[data-place-add-choice=account]"));
  expect(onAccount).toHaveBeenCalled();
  await click(q("[data-place-add-choice=organization]"));
  expect(q("[data-place-setup=organization]")).toBeTruthy();
});

it("a server signed in to the account but not connected here goes straight to its address", async () => {
  vi.stubGlobal("duskDesktop", { workspaces: { add: vi.fn() } });
  await act(async () => { root.render(createElement(PlaceSetup, { onClose: vi.fn(), connect: "studio" })); });
  expect(q("h2")?.textContent).toBe("connect studio");
  expect(q("[data-place-setup-way=address]")).toBeTruthy();
});

it("choosing dusk cloud opens the buying sheet, never Settings", async () => {
  vi.stubGlobal("duskDesktop", { cloudAccount: {} });
  const { openPlaceSetup } = await import("@/lib/place-setup");
  const { PlaceSetupHost } = await import("./PlaceSetupHost");
  openPlaceSetup();
  await act(async () => { root.render(createElement(PlaceSetupHost)); });
  await click(q("[data-place-add-choice=cloud]"));
  expect(fixture.dispatch).toHaveBeenCalledWith({ type: "openCloudAdd", source: "app_settings" });
  expect(fixture.dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: "toggleAppSettings" }));
});

it("the rail's sheet buys a first cloud and hands a server to the app window, each through main", async () => {
  const onBuy = vi.fn(), onServer = vi.fn(), onClose = vi.fn();
  vi.stubGlobal("duskDesktop", { cloudAccount: {}, workspaces: { add: vi.fn() } });
  await act(async () => { root.render(createElement(PlaceSetup, { onClose, onBuy, onServer, choices: { cloud: true, link: true, address: true } })); });
  await click(q("[data-place-add-choice=cloud]"));
  expect(onBuy).toHaveBeenCalledTimes(1);
  await act(async () => { root.render(createElement(PlaceSetup, { key: "again", onClose, onBuy, onServer, choices: { cloud: true, link: true, address: true } })); });
  await click(q("[data-place-add-choice=server]"));
  expect(onServer).toHaveBeenCalledTimes(1);
  expect(onClose).toHaveBeenCalledTimes(2);
});

it("this computer with no bots names the server they are on, switches there, or brings them back", async () => {
  const link = fakeLink();
  const open = vi.fn(async () => true);
  vi.stubGlobal("duskDesktop", { vpsLink: link.bridge, platform: "darwin", elsewhere: { open } });
  const onClose = vi.fn();
  await act(async () => { root.render(createElement(MacEmptyMain, { from: { id: "vps-1", name: "my-vps", why: "moved" }, onClose })); });
  await settle();
  expect(q("[role=dialog] h2")?.textContent).toBe("your bots are on my-vps");
  expect(q("[role=dialog] [data-place-art=server]")).toBeTruthy();
  expect(byText("new bot")).toBeUndefined();
  expect(q("[data-mac-empty-open]")?.textContent).toBe("switch to my-vps");
  await click(q("[data-mac-empty-open]"));
  expect(open).toHaveBeenCalledWith("vps-1");
  expect(q("[data-mac-empty-back]")?.textContent).toBe("bring them back here");
  await click(q("[data-mac-empty-back]"));
  expect(q("[role=alertdialog] h2")?.textContent).toBe("bring your bots back to this Mac?");
  await click(byText("bring them back"));
  expect(link.bridge.moveBack).toHaveBeenCalledTimes(1);
  expect(q("[role=status]")?.textContent).toContain("Bringing your bots back");
  expect(onClose).not.toHaveBeenCalled();
});

it("a switch that fails says so in the dialog", async () => {
  vi.stubGlobal("duskDesktop", { elsewhere: { open: vi.fn(async () => false) } });
  await act(async () => { root.render(createElement(MacEmptyMain, { from: { id: "team", name: "Studio", why: "team" }, onClose: vi.fn() })); });
  await settle();
  await click(q("[data-mac-empty-open]"));
  expect(q("[role=alert]")?.textContent).toContain("Couldn't reach Studio");
});

function PromptHost({ id }: { id: string }) {
  const [shown, dismiss] = useMacEmptyPrompt({ id, name: id, why: "moved" });
  return shown ? createElement(MacEmptyMain, { from: { id, name: id, why: "moved" }, onClose: dismiss }) : null;
}

it("the no-bots dialog shows once per place and closes on not now, Escape or a click outside", async () => {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value) });
  vi.stubGlobal("duskDesktop", {});
  await act(async () => { root.render(createElement(PromptHost, { id: "a" })); });
  await click(q("[data-mac-empty-later]"));
  expect(q("[data-mac-empty]")).toBeNull();
  await act(async () => { root.render(createElement(PromptHost, { id: "b" })); });
  expect(q("[data-mac-empty=b]")).toBeTruthy();
  await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
  expect(q("[data-mac-empty]")).toBeNull();
  await act(async () => { root.render(createElement(PromptHost, { id: "c" })); });
  await act(async () => { q("[data-modal-scrim]")!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); });
  expect(q("[data-mac-empty]")).toBeNull();
  await act(async () => { root.render(createElement(PromptHost, { id: "a" })); });
  expect(q("[data-mac-empty]")).toBeNull();
});

it("bots on a place they can't come back from are switched to, with nothing to bring back", async () => {
  const open = vi.fn(async () => true);
  vi.stubGlobal("duskDesktop", { elsewhere: { open } });
  await act(async () => { root.render(createElement(MacEmptyMain, { from: { id: "team", name: "Studio", why: "team" }, onClose: vi.fn() })); });
  await settle();
  expect(q("[role=dialog] [data-place-art=cloud]")).toBeTruthy();
  expect(q("[data-mac-empty-back]")).toBeNull();
  await click(q("[data-mac-empty-open]"));
  expect(open).toHaveBeenCalledWith("team");
});

it("before a line exists it says it is making one, with no step waiting yet", async () => {
  const link = fakeLink();
  (link.bridge as unknown as { start: () => Promise<never> }).start = () => new Promise<never>(() => {});
  vi.stubGlobal("duskDesktop", { vpsLink: link.bridge });
  await act(async () => { root.render(createElement(PlaceSetup, { onClose: vi.fn(), start: "install" })); });
  await settle();
  expect(q("[data-install-phase]")?.getAttribute("data-install-phase")).toBe("starting");
  expect(q("li")).toBeNull();
  expect(q("[role=status]")?.textContent).toBe("making your line…");
});
