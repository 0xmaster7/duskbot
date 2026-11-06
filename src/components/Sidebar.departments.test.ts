import { Children, isValidElement, type EffectCallback, type ReactElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Action, AppState, Bot, Group, Task } from "@/state/store";

const fixture = vi.hoisted(() => ({
  values: [] as unknown[], index: 0, advanced: false, phone: false, admin: null as boolean | null,
  state: {} as AppState, dispatch: vi.fn(), storage: new Map<string, string>(),
  requests: [] as Array<{ path: string; method: string; body: unknown }>,
}));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = fixture.index++;
    if (!(index in fixture.values)) fixture.values[index] = typeof initial === "function" ? (initial as () => unknown)() : initial;
    return [fixture.values[index], (next: unknown) => {
      fixture.values[index] = typeof next === "function" ? (next as (value: unknown) => unknown)(fixture.values[index]) : next;
    }];
  },
  useRef: (initial: unknown) => {
    const index = fixture.index++;
    if (!(index in fixture.values)) fixture.values[index] = { current: initial };
    return fixture.values[index];
  },
  useCallback: (callback: unknown) => callback,
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
  useEffect: (_effect: EffectCallback) => {},
  useLayoutEffect: () => {},
}));
vi.mock("react-dom", () => ({ createPortal: (node: ReactNode) => node }));
vi.mock("./MenuMotion", () => ({
  useMenuMotion: (open: boolean) => ({ shown: open, closing: false, className: "", exitProps: {} }),
  useHeldMenuMotion: (value: unknown) => ({ shown: value !== null, value, closing: false, className: "", exitProps: {} }),
}));
vi.mock("./DesktopCapabilities", async () => {
  const { initialDesktopCapabilities } = await import("@/lib/desktop");
  return { useDesktopCapabilities: () => ({ capabilities: initialDesktopCapabilities() }), windowFramed: () => false };
});
vi.mock("@/lib/thread-preferences", () => ({ useShowThreads: () => fixture.advanced }));
vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => fixture.advanced, setAdvancedMode: () => {} }));
vi.mock("@/lib/use-owner-or-admin", () => ({ useOwnerOrAdmin: () => fixture.admin }));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({ state: fixture.state, dispatch: fixture.dispatch }) };
});

import { initialState } from "@/state/store";
import { BOTS_SECTION_ID, CHANNELS_SECTION_ID, userSectionId } from "@/lib/sidebar-layout";
import { PHONE_LAYOUT } from "@/lib/use-media-query";
import { BotContextMenu, BotListItem, Sidebar } from "./Sidebar";
import { SidebarSectionHeader } from "./SidebarSectionHeader";
import { ConfirmDialog } from "./ConfirmDialog";

const bot = (id: string, extra: Partial<Bot> = {}): Bot => ({
  id, threadId: `${id}-thread`, name: id, title: "", description: "", notifications: true,
  color: "green", unread: false, modelSelection: { instanceId: "fake", model: "m" }, messages: [], ...extra,
});
const room: Group = {
  id: "room", threadId: "room-thread", name: "Launch room", memberIds: ["atlas"], messages: [],
  defaultResponder: { kind: "mentions" }, bulletin: "", unread: false, createdAt: 1,
};

type Props = { children?: ReactNode; [key: string]: unknown };
type RowProps = Parameters<typeof BotListItem>[0];
type HeaderProps = Parameters<typeof SidebarSectionHeader>[0];
function nodes(value: ReactNode): ReactElement<Props>[] {
  return Children.toArray(value).flatMap((child) => {
    if (!isValidElement<Props>(child)) return [];
    return [child, ...nodes(child.props.children)];
  });
}
function render() {
  fixture.index = 0;
  const root = Sidebar({ open: false, onClose: () => {} }) as ReactElement<Props>;
  return [root, ...nodes(root.props.children)];
}
const rows = () => render().filter((node) => node.type === BotListItem).map((node) => node.props as unknown as RowProps);
const row = (id: string) => rows().find((props) => props.bot.id === id)!;
const listed = () => rows().map((props) => props.bot.id);
const sections = () => render().map((node) => node.props["data-sidebar-section-id"]).filter(Boolean);
const section = (id: string) => render().find((node) => node.props["data-sidebar-section-id"] === id)!.props as unknown as {
  onDragOver: (event: unknown) => void; onDrop: (event: unknown) => void; children: ReactNode;
};
const headers = () => render().filter((node) => node.type === SidebarSectionHeader).map((node) => node.props as unknown as HeaderProps);
const header = (name: string) => headers().find((props) => props.name === name)!;
const actions = () => fixture.dispatch.mock.calls.map(([action]) => action as Action);

function transfer() {
  const data = new Map<string, string>();
  return { types: [] as string[], effectAllowed: "", dropEffect: "", setData(type: string, value: string) { data.set(type, value); this.types.push(type); }, getData: (type: string) => data.get(type) ?? "", setDragImage: vi.fn() };
}
let carried = transfer();
/** The bot rows a section's drop zone finds under it, each 54px tall from `top`. */
let rowElements: Array<{ dataset: { sidebarBotRow: string }; getBoundingClientRect: () => { top: number; bottom: number; height: number } }> = [];
/** A drag event `offset` pixels into a 54px row. */
const at = (offset = 27) => ({
  dataTransfer: carried, clientX: 100, clientY: offset, currentTarget: { getBoundingClientRect: () => ({ top: 0, left: 12, height: 54 }), querySelectorAll: () => rowElements },
  preventDefault: vi.fn(), stopPropagation: vi.fn(),
});
function drag(id: string) {
  carried = transfer();
  row(id).botDrag!.row(id).onDragStart(at() as never);
}

beforeEach(() => {
  fixture.values = [];
  fixture.advanced = false;
  fixture.phone = false;
  fixture.admin = null;
  fixture.storage = new Map();
  fixture.requests = [];
  rowElements = [];
  fixture.dispatch.mockClear();
  fixture.state = {
    ...initialState,
    bots: [bot("atlas"), bot("bea"), bot("cleo"), bot("dodo", { section: "Work" }), bot("echo", { section: "Work" })],
    groups: [room],
    sections: ["Work"],
  };
  vi.stubGlobal("window", Object.assign(new EventTarget(), {
    innerWidth: 1280, innerHeight: 800, ogb: undefined, setTimeout, clearTimeout,
    matchMedia: (query: string) => ({ matches: fixture.phone && query === PHONE_LAYOUT, addEventListener() {}, removeEventListener() {} }),
  }));
  vi.stubGlobal("document", { body: {}, querySelector: () => null });
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("Image", class { src = ""; });
  vi.stubGlobal("fetch", async (path: string, init: RequestInit) => {
    fixture.requests.push({ path, method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(JSON.stringify({ sections: ["Clients"], botIds: [] }), { status: 200 });
  });
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => fixture.storage.get(key) ?? null,
    setItem: (key: string, value: string) => { fixture.storage.set(key, value); },
    removeItem: (key: string) => { fixture.storage.delete(key); },
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("Simple's sidebar before anyone drags", () => {
  it("looks as it did: the same sections and rows, nothing marked, each row ready to drag", () => {
    expect(sections()).toEqual([userSectionId("Work"), BOTS_SECTION_ID, CHANNELS_SECTION_ID]);
    expect(headers().map((props) => props.name)).toEqual(["Work", "Unassigned", "Group chats"]);
    expect(listed()).toEqual(["dodo", "echo", "atlas", "bea", "cleo"]);
    for (const props of rows()) {
      expect(props.botDrop).toBeNull();
      expect(props.botDragging).toBe(false);
      expect(props.botDrag!.row(props.bot.id).draggable).toBe(true);
    }
    expect(headers().every((props) => !props.dropInto && !props.naming)).toBe(true);
  });

  it("leaves rows still on a phone, where the menu moves them", () => {
    fixture.phone = true;
    expect(rows().every((props) => props.botDrag === undefined)).toBe(true);
  });
});

describe("dragging a bot in Simple, as grok does", () => {
  const pinSlot = () => render().find((node) => node.props["data-bot-pin-slot"] !== undefined);
  it("lifts it with a slot to pin it, washes the section under it, and drops it at the top of another section", () => {
    drag("atlas");
    expect(row("atlas").botDragging).toBe(true);
    expect(pinSlot()).toBeDefined();
    section(userSectionId("Work")).onDragOver(at() as never);
    expect(String((section(userSectionId("Work")) as unknown as { className: string }).className)).toContain("bg-ink/[0.06]");
    expect(header("Work").dropInto).toBe(false);
    expect(rows().every((props) => !props.botDrop)).toBe(true);
    section(userSectionId("Work")).onDrop(at() as never);
    // atlas already comes before dodo and echo, so its new place at the top saves no new order
    expect(actions()).toEqual([{ type: "updateBot", botId: "atlas", patch: { section: "Work" } }]);
    // the slot fades out where it stands, as grok's does
    expect(render().some((node) => /\bopacity-0\b/.test(String(node.props.className)) && /\bpb-0\.5\b/.test(String(node.props.className)))).toBe(true);
  });

  it("leaves it where it was when dropped back on its own section, and pins it in the slot", () => {
    drag("dodo");
    section(userSectionId("Work")).onDragOver(at() as never);
    section(userSectionId("Work")).onDrop(at() as never);
    expect(actions()).toEqual([]);
    drag("bea");
    (pinSlot()!.props.onDrop as (event: unknown) => void)(at());
    expect(actions()).toEqual([{ type: "updateBot", botId: "bea", patch: { pinned: true } }]);
  });
});

describe("dragging a bot in Advanced's list", () => {
  beforeEach(() => { fixture.advanced = true; });

  it("offers a place to drop it out when every row is in a department", () => {
    fixture.state = { ...fixture.state, bots: fixture.state.bots.map((candidate) => ({ ...candidate, section: "Work" })) };
    expect(sections()).not.toContain(BOTS_SECTION_ID);
    drag("dodo");
    expect(sections()).toContain(BOTS_SECTION_ID);
    section(BOTS_SECTION_ID).onDragOver(at() as never);
    expect(render().some((node) => node.props["data-bot-drop-slot"] !== undefined)).toBe(true);
    section(BOTS_SECTION_ID).onDrop(at() as never);
    expect(actions()).toEqual([{ type: "updateBot", botId: "dodo", patch: { section: "" } }]);
    expect(sections()).not.toContain(BOTS_SECTION_ID);
  });

  it("never drops on group chats, and hands a heading's drag to the section order", () => {
    drag("atlas");
    const event = at();
    section(CHANNELS_SECTION_ID).onDragOver(event as never);
    expect(event.preventDefault).not.toHaveBeenCalled();
    section(CHANNELS_SECTION_ID).onDrop(event as never);
    expect(actions()).toEqual([]);
    expect(rows().every((props) => !props.botDragging)).toBe(true);
  });

  it("moves with Alt+Up/Down within its list and says where it went", () => {
    row("bea").botDrag!.step("bea", 1);
    expect(actions()).toEqual([{ type: "botsOrdered", botIds: ["atlas", "cleo", "bea"] }]);
    const live = render().find((node) => node.props["aria-live"] === "polite")!;
    expect(live.props.children).toBe("bea moved to position 3 of 3");
    fixture.dispatch.mockClear();
    row("atlas").botDrag!.step("atlas", -1);
    expect(actions()).toEqual([]);
  });

});

describe("bots that are working or waiting on the person", () => {
  const busy = (id: string, extra: Partial<Bot>) => {
    fixture.state = { ...fixture.state, bots: fixture.state.bots.map((item) => (item.id === id ? { ...item, ...extra } : item)) };
  };

  it("move to the top of their own list, in the person's order, and go back when done", () => {
    busy("cleo", { busy: true });
    busy("bea", { activity: "waiting-on-you" });
    busy("echo", { busy: true });
    expect(listed()).toEqual(["echo", "dodo", "bea", "cleo", "atlas"]);
    busy("cleo", { busy: false });
    busy("bea", { activity: "idle" });
    busy("echo", { busy: false });
    expect(listed()).toEqual(["dodo", "echo", "atlas", "bea", "cleo"]);
  });

  it("count a working thread, but not a wait on a teammate", () => {
    busy("cleo", { tasks: [{ threadId: "c1", title: "Run", createdAt: 1, busy: true } as Task] });
    busy("bea", { waitingForTeammates: true });
    expect(listed()).toEqual(["dodo", "echo", "cleo", "atlas", "bea"]);
  });

});

describe("who may drag a bot: whoever the bot menu offers Move to department", () => {
  it("gives a Team Cloud member without the admin scope no row to drag and no Alt+Up/Down, and starts no drag", () => {
    const drawnEarlier = row("atlas").botDrag!;
    fixture.admin = false;
    expect(listed()).toEqual(["dodo", "echo", "atlas", "bea", "cleo"]);
    expect(rows().map((props) => props.botDrag)).toEqual([undefined, undefined, undefined, undefined, undefined]);
    carried = transfer();
    drawnEarlier.row("atlas").onDragStart(at() as never);
    drawnEarlier.step("atlas", 1);
    expect(carried.types).toEqual([]);
    expect(actions()).toEqual([]);
  });

  it("drops nothing from a drag begun before the session said they are a member", () => {
    drag("atlas");
    fixture.admin = false;
    section(userSectionId("Work")).onDragOver(at() as never);
    section(userSectionId("Work")).onDrop(at() as never);
    expect(actions()).toEqual([]);
    expect(fixture.requests).toEqual([]);
  });

  it("lets an admin drag", () => {
    fixture.admin = true;
    for (const props of rows()) expect(props.botDrag!.row(props.bot.id).draggable).toBe(true);
    drag("atlas");
    section(userSectionId("Work")).onDrop(at() as never);
    expect(actions()).toEqual([{ type: "updateBot", botId: "atlas", patch: { section: "Work" } }]);
  });
});

describe("a section's menu", () => {
  const words = (node: ReactElement<Props>): string => Children.toArray(node.props.children).map((part) => typeof part === "string" ? part : isValidElement<Props>(part) ? words(part) : "").join("");
  const openMenu = (name: string) => {
    const button = { getBoundingClientRect: () => ({ left: 20, right: 280, bottom: 300 }), focus: vi.fn(), isConnected: true } as unknown as HTMLButtonElement;
    header(name).onMenu!(button);
    const items = render().filter((node) => node.props.role === "menuitem");
    return Object.fromEntries(items.map((node) => [words(node), node.props as { onClick: () => void; disabled?: boolean }]));
  };

  it("is grok's: Rename, Move up, Move down and Delete; Unassigned only moves", () => {
    expect(Object.keys(openMenu("Work"))).toEqual(["Rename", "Move up", "Move down", "Delete"]);
    expect(openMenu("Work")["Move up"]!.disabled).toBe(true);
    fixture.values = [];
    expect(Object.keys(openMenu("Unassigned"))).toEqual(["Move up", "Move down"]);
  });

  it("renames it in place", async () => {
    openMenu("Work")["Rename"]!.onClick();
    const naming = header("Work").naming!;
    expect([naming.value, naming.label]).toEqual(["Work", "Rename section"]);
    naming.onCommit("Clients");
    await vi.waitFor(() => expect(actions()).toEqual([{ type: "sections", sections: ["Clients"] }]));
    expect(fixture.requests).toEqual([{ path: "/api/sidebar-sections?section=Work", method: "PATCH", body: { name: "Clients" } }]);
  });

  it("deletes it saying the bots stay, out of any department", () => {
    openMenu("Work")["Delete"]!.onClick();
    const dialog = render().find((node) => node.type === ConfirmDialog && node.props.open === true)!;
    expect([dialog.props.title, dialog.props.body, dialog.props.confirmLabel]).toEqual(["Delete \u201cWork\u201d", "Its Bots move to Unassigned. No Bots are deleted.", "Delete"]);
  });

  it("is the same menu in Advanced, from a right-click on its name", () => {
    fixture.advanced = true;
    const button = { getBoundingClientRect: () => ({ right: 280, bottom: 300 }), focus: vi.fn(), isConnected: true } as unknown as HTMLButtonElement;
    header("Work").onContextMenu!({ preventDefault: () => {}, clientX: 10, clientY: 10, currentTarget: { querySelector: () => button } } as never);
    expect(render().filter((node) => node.props.role === "menuitem").map(words)).toEqual(["Rename", "Move up", "Move down", "Delete"]);
  });
});

describe("a bot's menu in Simple", () => {
  type MenuProps = Parameters<typeof BotContextMenu>[0];
  const menuProps = (botId: string, extra: Partial<MenuProps> = {}): MenuProps => ({
    menu: { botId, x: 0, y: 0 }, onClose: vi.fn(), onArchive: vi.fn(), onDelete: vi.fn(),
    onNewSection: vi.fn(), ...extra,
  });
  const open = (props: MenuProps) => {
    fixture.index = 0;
    const tree = nodes(BotContextMenu(props));
    const move = tree.find((node) => node.props["data-bot-menu-move"] !== undefined)!;
    (move.props.onClick as (event: { detail: number }) => void)({ detail: 1 });
    fixture.index = 0;
    const flyout = nodes(BotContextMenu(props)).find((node) => node.props["data-bot-menu-flyout"] === "move")!;
    return nodes(flyout.props.children).filter((node) => String(node.props.role).startsWith("menuitem"));
  };
  const label = (node: ReactElement<Props>): string => Children.toArray(node.props.children).map((part) => typeof part === "string" ? part : isValidElement<Props>(part) && part.props["aria-hidden"] !== "true" ? label(part) : "").join("");

  it("moves it to a section, out to Unassigned, or into a new one, from grok's Move to", () => {
    fixture.state = { ...fixture.state, sections: ["Work", "Home"] };
    const props = menuProps("dodo");
    const items = open(props);
    expect(items.map(label)).toEqual(["Work", "Home", "Unassigned", "Create section"]);
    expect(items.map((item) => item.props["aria-checked"])).toEqual([true, false, false, undefined]);
    (items[1]!.props.onClick as () => void)();
    (items[2]!.props.onClick as () => void)();
    expect(actions()).toEqual([
      { type: "updateBot", botId: "dodo", patch: { section: "Home" } },
      { type: "updateBot", botId: "dodo", patch: { section: "" } },
    ]);
    (items[3]!.props.onClick as () => void)();
    expect(props.onNewSection).toHaveBeenCalledWith("dodo");
  });

  it("offers Move to new section, with no flyout, while there are no sections", () => {
    fixture.state = { ...fixture.state, sections: [], bots: [bot("atlas"), bot("bea")] };
    const props = menuProps("atlas");
    fixture.index = 0;
    const item = nodes(BotContextMenu(props)).find((node) => node.props.role === "menuitem" && label(node) === "Move to new section")!;
    (item.props.onClick as () => void)();
    expect(props.onNewSection).toHaveBeenCalledWith("atlas");
  });
});

describe("deleting a Chief of Staff", () => {
  type MenuProps = Parameters<typeof BotContextMenu>[0];
  const askToDelete = (target: Bot) => (render().find((node) => node.type === BotContextMenu)!.props as unknown as MenuProps).onDelete(target);
  const openDialog = () => render().find((node) => node.type === ConfirmDialog && node.props.open === true);

  it("offers Archive first, which keeps its chats, and archives it as an ordinary bot", async () => {
    const chief = bot("atlas", { chiefOfStaff: true });
    fixture.state = { ...fixture.state, bots: [chief, bot("bea")] };
    askToDelete(chief);
    const dialog = openDialog()!;
    expect(dialog.props.body).toBe("It's your Chief of Staff. Archive it instead to keep its chats.");
    const alternative = dialog.props.alternative as { label: string; onClick: () => void };
    expect(alternative.label).toBe("Archive instead");
    alternative.onClick();
    await vi.waitFor(() => expect(fixture.requests).toContainEqual({ path: "/api/bots/atlas", method: "PATCH", body: { hidden: true, chiefOfStaff: false } }));
    expect(openDialog()).toBeUndefined();
  });

  it("offers nothing else for any other bot, or for the last bot there is", () => {
    askToDelete(bot("bea"));
    expect(openDialog()!.props.alternative).toBeUndefined();
    const chief = bot("atlas", { chiefOfStaff: true });
    fixture.values = [];
    fixture.state = { ...fixture.state, bots: [chief] };
    askToDelete(chief);
    expect(openDialog()!.props.alternative).toBeUndefined();
  });
});
