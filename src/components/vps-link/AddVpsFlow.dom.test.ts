// @vitest-environment happy-dom
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";

vi.mock("@/components/Avatar", () => ({
  MausAvatar: (props: { state?: string }) => createElement("span", { "data-mascot": props.state ?? "idle" }),
  BotAvatar: () => createElement("span", { "data-bot-avatar": "" }),
}));
vi.mock("@/state/store", async (original) => ({
  ...await original<typeof import("@/state/store")>(),
  useStore: () => ({ state: { bots: [], config: {} }, dispatch: vi.fn() }),
}));
import { EMPTY_VIEW, VPS_STEP_IDS, type VpsLinkBridge, type VpsLinkView } from "@/lib/vps-link";
import { AddVpsFlow } from "./AddVpsFlow";
import { TransferSettings } from "./TransferSettings";

const COMMAND = "curl -fsSL https://link.apps.siddz.com/i/ab3d7fgh2k-q4mxw7e2r5t6y7u8i9o2p3a4s5 | sh";
const SERVER = { id: "vps-1", name: "My VPS", origin: "http://vps-ab3d7fgh2k.localhost:47811" };
const steps = (done: number, failed?: { at: number; log: string }) => VPS_STEP_IDS.map((id, index) => ({
  id, status: index < done ? "done" as const : failed && index === failed.at ? "failed" as const : "waiting" as const,
  ...(failed && index === failed.at ? { log: failed.log } : {}),
}));

/** A fake main: the relay's states arrive through onChange as the real one sends them. */
function fakeBridge() {
  let view: VpsLinkView = EMPTY_VIEW;
  const listeners = new Set<(view: VpsLinkView) => void>();
  const bridge = {
    state: vi.fn(async () => view),
    start: vi.fn(async () => (view = { ...EMPTY_VIEW, stage: "command", command: COMMAND, expiresAt: Date.now() + 25 * 60_000 })),
    cancel: vi.fn(async () => (view = EMPTY_VIEW)),
    reset: vi.fn(async () => (view = EMPTY_VIEW)),
    engines: vi.fn(async () => [
      { instanceId: "claude", kind: "claude" as const, name: "Claude Code", signedIn: false },
      { instanceId: "codex", kind: "codex" as const, name: "Codex", signedIn: false },
    ]),
    // claude setup-token on this computer opens the browser itself; a later answer falls back to the server's own page
    signIn: vi.fn(async () => ({ flowId: "f1", phase: "waiting" as const, authorizationUrl: null, needsCode: false, message: "Your browser opened. Approve there." })),
    signInStatus: vi.fn(async () => ({ flowId: "f1", phase: "waiting" as const, authorizationUrl: "https://claude.ai/oauth", needsCode: true })),
    signInCode: vi.fn(async () => ({ ok: true as const })),
    signInCancel: vi.fn(async () => ({ ok: true as const })),
    openUrl: vi.fn(async () => {}),
    preview: vi.fn(async () => ({ bots: [{ id: "b1", name: "Pixel" }, { id: "b2", name: "Scout" }], chats: 14, messages: 420, skills: 3, memories: 12, routines: 2, apps: 1, bytes: 52_428_800 })),
    move: vi.fn(async () => (view = { ...view, stage: "moving", move: { step: "copy", status: "running", chats: { done: 3, total: 14 } } })),
    open: vi.fn(async () => {}),
    where: vi.fn(async () => ({ place: "vps" as const, server: SERVER })),
    backups: vi.fn(async () => [{ id: "k1", at: Date.UTC(2026, 10, 7, 9), bytes: 1_048_576, reason: "before-move" as const, summary: { bots: 2, chats: 14, skills: 3, routines: 2 } }]),
    backupNow: vi.fn(async () => ({ id: "k2" })),
    restore: vi.fn(async () => ({ ok: true as const, restart: true as const })),
    moveBack: vi.fn(async () => ({ ok: true as const })),
    forget: vi.fn(async () => (view = EMPTY_VIEW)),
    onChange: vi.fn((callback: (view: VpsLinkView) => void) => { listeners.add(callback); return () => listeners.delete(callback); }),
  } satisfies VpsLinkBridge;
  const emit = async (next: VpsLinkView) => { view = next; await act(async () => { for (const listen of listeners) listen(next); }); await settle(); };
  return { bridge, emit, view: () => view };
}

let container: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  setLocale("en");
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); document.body.innerHTML = ""; vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const settle = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };
const text = () => document.body.textContent ?? "";
const button = (label: string) => {
  const all = [...document.querySelectorAll("button")];
  return all.find((item) => item.textContent?.trim() === label || item.getAttribute("aria-label") === label) ?? all.find((item) => item.textContent?.trim().startsWith(label));
};
const click = async (target: Element | null | undefined) => { expect(target).toBeTruthy(); await act(async () => { (target as HTMLElement).click(); }); await settle(); };
/** The stage the sheet shows once its slide between screens has finished. */
const stageShown = async (stage: number) => {
  for (let i = 0; i < 60 && document.querySelector("[data-vps-stage]")?.getAttribute("data-vps-stage") !== String(stage); i++) await settle();
  expect(document.querySelector("[data-vps-stage]")?.getAttribute("data-vps-stage")).toBe(String(stage));
  for (let i = 0; i < 20; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
};

describe("Add your VPS", () => {
  it("goes from the one line to paste, through the install and a failed step, sign-in and the move, to done", async () => {
    const fake = fakeBridge();
    vi.stubGlobal("ogb", { platform: "darwin", vpsLink: fake.bridge });
    await act(async () => { root.render(createElement(AddVpsFlow, { onClose: () => {} })); });
    await settle();

    // 1: a fresh sheet asks main for a line once and shows it
    await stageShown(1);
    expect(fake.bridge.start).toHaveBeenCalledTimes(1);
    expect(document.querySelector("[data-vps-command]")?.textContent).toBe(COMMAND);
    expect(text()).toContain("Paste one line on your server");
    expect(text()).toContain("Open your server's terminal");

    // 2: the relay's steps arrive; a failed one says so in words and shows its log tail and the same line again
    await fake.emit({ ...fake.view(), stage: "installing", steps: steps(1, { at: 1, log: "E: Unable to locate package curl" }) });
    await stageShown(2);
    expect(text()).toContain("Checking your server");
    expect(text()).toContain("Didn't work");
    expect(text()).toContain("Something got stuck");
    expect(document.querySelector("pre")?.textContent).toContain("Unable to locate package curl");
    expect(document.querySelectorAll("[data-vps-command]").length).toBe(1);

    // 3: linked: sign in to the AI on this Mac, a pasted code goes back through main
    await fake.emit({ ...fake.view(), stage: "linked", steps: steps(VPS_STEP_IDS.length), server: SERVER });
    await stageShown(3);
    expect(text()).toContain("Sign in to your AI");
    expect(text()).toContain("on this Mac");
    expect(text()).toContain("My VPS");
    await click(document.querySelector("[data-vps-engine='claude'] button"));
    expect(fake.bridge.signIn).toHaveBeenCalledWith("claude");
    expect(text()).toContain("Your browser opened. Approve there.");
    expect(fake.bridge.openUrl).not.toHaveBeenCalled();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 2100)); });
    await settle();
    expect(fake.bridge.signInStatus).toHaveBeenCalledWith("claude", "f1");
    expect(fake.bridge.openUrl).toHaveBeenCalledWith("https://claude.ai/oauth");
    expect(text()).toContain("Paste the code from the page");
    await click(button("Skip for now"));

    // 4: what moves, then the move's steps, then done
    await stageShown(4);
    expect(text()).toContain("Move everything to My VPS");
    expect(text()).toContain("Pixel");
    expect(text()).toContain("14 · 420 messages");
    expect(text()).toContain("50 MB");
    await click(button("Move everything here"));
    expect(fake.bridge.move).toHaveBeenCalledTimes(1);
    await settle();
    expect(text()).toContain("Saving a backup on this Mac first");
    expect(text()).toContain("3 of 14 chats");
    await fake.emit({ ...fake.view(), move: { step: "verify", status: "failed", error: "Two chats did not arrive." } });
    expect(text()).toContain("Two chats did not arrive.");
    expect(text()).toContain("Nothing was removed from this Mac");
    await fake.emit({ ...fake.view(), stage: "moved", move: { step: "done", status: "done", kept: true } });
    expect(text()).toContain("Your bots live on My VPS now");
    expect(text()).toContain("this Mac kept its copy too");
    await click(button("Open My VPS"));
    expect(fake.bridge.open).toHaveBeenCalledTimes(1);
  });

  it("picks up an install already under way instead of making a new line", async () => {
    const fake = fakeBridge();
    await fake.bridge.start();
    fake.bridge.start.mockClear();
    await fake.emit({ ...fake.view(), stage: "installing", steps: steps(4) });
    vi.stubGlobal("ogb", { platform: "linux", vpsLink: fake.bridge });
    await act(async () => { root.render(createElement(AddVpsFlow, { onClose: () => {} })); });
    await stageShown(2);
    expect(fake.bridge.start).not.toHaveBeenCalled();
    expect(text()).toContain("4 of 11 done");
  });
});

describe("Settings > Transfer", () => {
  it("says where the bots live, moves them back after a confirm and lists the backups", async () => {
    const fake = fakeBridge();
    const confirm = vi.fn(async () => true);
    vi.stubGlobal("ogb", { platform: "darwin", vpsLink: fake.bridge, confirm });
    await act(async () => { root.render(createElement(TransferSettings)); });
    await settle();
    expect(text()).toContain("My VPS");
    expect(text()).toContain("Restore last backup");
    expect(text()).toContain("2 bots, 14 chats, 3 skills, 2 routines · 1.0 MB");
    expect(text()).toContain("Before a move");
    await click(button("Move to this Mac"));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("A backup is saved first"));
    expect(fake.bridge.moveBack).toHaveBeenCalledTimes(1);
  });
});
