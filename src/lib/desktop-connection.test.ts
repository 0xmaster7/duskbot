// @vitest-environment happy-dom
// One connection path for every in-app desktop: the panel's live desktop and the full-page viewer.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const paint = vi.hoisted(() => ({ opaque: true }));
const clients = vi.hoisted(() => [] as Array<{
  url: string;
  password: string;
  viewOnly: boolean;
  focusOnClick: boolean;
  listeners: Map<string, Array<(event: { detail: { text: string } }) => void>>;
  disconnected: number;
  emit(type: string, text?: string): void;
}>);
vi.mock("@novnc/novnc", () => ({
  default: class {
    url: string;
    password: string;
    listeners = new Map<string, Array<(event: { detail: { text: string } }) => void>>();
    disconnected = 0;
    viewOnly = false;
    focusOnClick = true;
    scaleViewport = false;
    background = "";
    constructor(screen: HTMLElement, url: string, options: { credentials: { password: string } }) {
      this.url = url;
      this.password = options.credentials.password;
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 16;
      canvas.getContext = vi.fn(() => ({ getImageData: () => ({ data: [255, 0, 0, paint.opaque ? 255 : 0] }) })) as never;
      screen.append(canvas);
      clients.push(this);
    }
    addEventListener(type: string, listener: (event: { detail: { text: string } }) => void) {
      this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
    }
    disconnect() {
      this.disconnected++;
      this.emit("disconnect");
    }
    emit(type: string, text = "") {
      for (const listener of this.listeners.get(type) ?? []) listener({ detail: { text } });
    }
  },
}));

const { connectDesktop, DesktopUnreachable, hideDesktopPointer, isPasteShortcut, pasteOnDesktop, typeOnDesktop } = await import("./desktop-connection");
const asked: string[] = [];
const events = () => ({ connected: vi.fn(), disconnected: vi.fn(), clipboard: vi.fn() });

beforeEach(() => {
  paint.opaque = true;
  clients.length = 0;
  asked.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    asked.push(`${init?.method ?? "GET"} ${url}`);
    return new Response(JSON.stringify({ password: "fixture-secret" }), { status: 200 });
  }));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("connecting to a desktop", () => {
  it("speaks RFB through the app's own proxy, never the VM's page", async () => {
    const on = events();
    await connectDesktop(document.createElement("div"), `local/bot-${"a".repeat(64)}`, { signal: new AbortController().signal, events: on });
    expect(asked).toEqual([`GET /api/desktop-viewer/local/bot-${"a".repeat(64)}`]);
    expect(clients[0]!.url).toBe(`ws://${location.host}/api/desktop-viewer/local/bot-${"a".repeat(64)}/websockify`);
    expect(clients[0]!.password).toBe("fixture-secret");
    clients[0]!.emit("connect");
    clients[0]!.emit("clipboard", "copied");
    expect(on.connected).toHaveBeenCalledTimes(1);
    expect(on.clipboard).toHaveBeenCalledWith("copied");
  });

  it("opens a VPS's tunnel for this conversation first", async () => {
    await connectDesktop(document.createElement("div"), "vps/scout", { threadId: "thread", signal: new AbortController().signal, events: events() });
    expect(asked).toEqual(["POST /api/bots/scout/computer/join?viewer=proxy&threadId=thread", "GET /api/desktop-viewer/vps/scout?threadId=thread"]);
    // the server answers the desktop's handshake for a VPS viewer
    expect(clients[0]!.url).toBe(`ws://${location.host}/api/desktop-viewer/vps/scout/websockify?threadId=thread&rfb=server`);
  });

  it("waits for decoded pixels before enabling control", async () => {
    vi.useFakeTimers();
    paint.opaque = false;
    const on = events();
    await connectDesktop(document.createElement("div"), "local/shared", { signal: new AbortController().signal, events: on });
    clients[0]!.emit("connect");
    await vi.advanceTimersByTimeAsync(64);
    expect(on.connected).not.toHaveBeenCalled();
    paint.opaque = true;
    await vi.advanceTimersByTimeAsync(32);
    expect(on.connected).toHaveBeenCalledTimes(1);
  });

  it("uses authenticated join credentials without a second config round trip", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      asked.push(url);
      return new Response(JSON.stringify({ viewer: { password: "fixture" } }));
    }));
    await connectDesktop(document.createElement("div"), "vps/scout", { signal: new AbortController().signal, events: events() });
    expect(asked).toEqual(["/api/bots/scout/computer/join?viewer=proxy"]);
    expect(clients[0]!.password).toBe("fixture");
  });

  it("asks for the picture beside a wake, so the server opens it the moment the container runs", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      asked.push(url);
      return new Response(JSON.stringify({ viewer: { password: "fixture" } }));
    }));
    await connectDesktop(document.createElement("div"), "vps/scout", { threadId: "thread", wake: true, signal: new AbortController().signal, events: events() });
    expect(asked).toEqual(["/api/bots/scout/computer/join?viewer=proxy&wake=1&threadId=thread"]);
    expect(clients[0]!.url).toBe(`ws://${location.host}/api/desktop-viewer/vps/scout/websockify?threadId=thread&rfb=server`);
  });

  it("refuses a target the proxy does not serve, before any request", async () => {
    await expect(connectDesktop(document.createElement("div"), "../api/secret", { signal: new AbortController().signal, events: events() }))
      .rejects.toMatchObject({ invalid: true });
    expect(asked).toEqual([]);
  });

  it("a viewer the server refuses is unreachable, not a hang", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 409 })));
    await expect(connectDesktop(document.createElement("div"), "local/shared", { signal: new AbortController().signal, events: events() }))
      .rejects.toBeInstanceOf(DesktopUnreachable);
  });

  it("a desktop that never answers is given up after 15 seconds, and says so once", async () => {
    vi.useFakeTimers();
    const on = events();
    await connectDesktop(document.createElement("div"), "local/shared", { signal: new AbortController().signal, events: on });
    await vi.advanceTimersByTimeAsync(15_000);
    expect(clients[0]!.disconnected).toBe(1);
    expect(on.disconnected).toHaveBeenCalledTimes(1);
    clients[0]!.emit("connect");
    expect(on.connected).not.toHaveBeenCalled();
  });

  it("goes quiet once the viewer has left", async () => {
    vi.useFakeTimers();
    const left = new AbortController();
    const on = events();
    await connectDesktop(document.createElement("div"), "local/shared", { signal: left.signal, events: on });
    left.abort();
    clients[0]!.emit("connect");
    await vi.advanceTimersByTimeAsync(20_000);
    expect(on.connected).not.toHaveBeenCalled();
    expect(on.disconnected).not.toHaveBeenCalled();
    expect(clients[0]!.disconnected).toBe(1);
  });

  it("starts watching with keyboard and pointer input disabled", async () => {
    await connectDesktop(document.createElement("div"), "local/shared", {
      signal: new AbortController().signal, events: events(), viewOnly: true,
    });
    expect(clients[0]!.viewOnly).toBe(true);
    expect(clients[0]!.focusOnClick).toBe(false);
  });

  it("never draws the desktop's own pointer, so the person keeps theirs over the picture", async () => {
    // noVNC 1.7's own cursor, as RFB keeps it until it attaches on the next tick
    const { default: Cursor } = await import("../../node_modules/@novnc/novnc/core/util/cursor.js" as string);
    const cursor = new Cursor();
    hideDesktopPointer({ _cursor: cursor } as never);
    const canvas = document.createElement("canvas");
    document.body.append(canvas);
    cursor.attach(canvas);
    cursor.change(new Uint8Array(4 * 4 * 4).fill(255), 0, 0, 4, 4);
    cursor.change(new Uint8Array(0), 0, 0, 0, 0);
    expect(canvas.style.cursor).toBe("");
    cursor.detach();
    canvas.remove();
  });

  it("types text as keysyms, Latin and not", () => {
    const sent: number[] = [];
    typeOnDesktop({ sendKey: (keysym: number) => sent.push(keysym) } as never, "a\n\tП");
    expect(sent).toEqual([0x61, 0xff0d, 0xff09, 0x0100041f]);
  });

  it("knows the person's paste shortcut on their own machine", () => {
    const key = (patch: Partial<KeyboardEvent>) => ({ key: "v", code: "KeyV", metaKey: false, ctrlKey: false, altKey: false, ...patch });
    expect(isPasteShortcut(key({ metaKey: true }), true)).toBe(true);
    expect(isPasteShortcut(key({ ctrlKey: true }), true), "Ctrl+V on a Mac still goes to the guest").toBe(false);
    expect(isPasteShortcut(key({ ctrlKey: true }), false)).toBe(true);
    expect(isPasteShortcut(key({ metaKey: true, altKey: true }), true)).toBe(false);
    expect(isPasteShortcut(key({ metaKey: true, key: "c", code: "KeyC" }), true)).toBe(false);
  });

  // what noVNC 1.7 tracks: Cmd on a Mac is held on the guest as Alt
  const guest = (viewOnly = false) => {
    const sent: Array<[number, string, boolean]> = [];
    const pasted: string[] = [];
    const keyDownList: Record<string, number> = { MetaLeft: 0xffe9 };
    const client = {
      viewOnly,
      clipboardPasteFrom: (text: string) => pasted.push(text),
      sendKey: (keysym: number, code: string, down: boolean) => sent.push([keysym, code, down]),
      _keyboard: {
        _keyDownList: keyDownList,
        _sendKeyEvent(keysym: number, code: string, down: boolean) {
          delete keyDownList[code];
          client.sendKey(keysym, code, down);
        },
      },
    };
    return { client, sent, pasted, keyDownList };
  };

  it("pastes as the guest clipboard plus a bare Shift+Insert, releasing the shortcut's modifier first", () => {
    const { client, sent, pasted, keyDownList } = guest();
    pasteOnDesktop(client as never, "pasted from the mac");
    expect(pasted).toEqual(["pasted from the mac"]);
    expect(sent).toEqual([
      [0xffe9, "MetaLeft", false],
      [0xffe1, "ShiftLeft", true],
      [0xff63, "Insert", true],
      [0xff63, "Insert", false],
      [0xffe1, "ShiftLeft", false],
    ]);
    expect(keyDownList, "the physical release later sends nothing twice").toEqual({});
  });

  it("pastes nothing while watching or when there is no text", () => {
    const watching = guest(true);
    pasteOnDesktop(watching.client as never, "text");
    const empty = guest();
    pasteOnDesktop(empty.client as never, "");
    expect([watching.sent, watching.pasted, empty.sent, empty.pasted]).toEqual([[], [], [], []]);
  });

  it("relies on the release path noVNC itself keeps", async () => {
    const { createRequire } = await import("node:module");
    const rfb = createRequire(import.meta.url).resolve("@novnc/novnc");
    const { default: Keyboard } = await import(/* @vite-ignore */ new URL("input/keyboard.js", `file://${rfb}`).href) as { default: new (target: HTMLElement) => { _keyDownList: object; _sendKeyEvent: unknown } };
    const keyboard = new Keyboard(document.createElement("div"));
    expect(keyboard._keyDownList).toEqual({});
    expect(typeof keyboard._sendKeyEvent).toBe("function");
  });
});
