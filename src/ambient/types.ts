// The summary the app's page publishes for the notch island and the bot dock, as electron/ambient-state.mjs checks it.
import type { MausColor } from "../../shared/wire";

export type AmbientStatus = "idle" | "thinking" | "working" | "talking" | "needs-you" | "done" | "error";

export interface AmbientBot {
  id: string;
  threadId: string;
  name: string;
  color: MausColor;
  body: string | null;
  face: "white" | "black" | null;
  avatar: string | null;
  status: AmbientStatus;
  /** What a running turn is doing ("Reading index.ts"), or what it waits on. */
  detail: string;
  /** The newest line in its chat, plain text. */
  line: string;
  /** When that line landed, or the turn started. */
  at: number;
  unread: boolean;
  /** Questions and approvals waiting on the person. */
  asks: number;
  /** The one approval the island can answer in place. */
  approval: { requestId: string; threadId: string; title: string } | null;
}

export interface AmbientSnapshot {
  bots: AmbientBot[];
  /** The surfaces' words in the person's language (labels.ts). */
  labels: import("./say").AmbientLabels;
  lang: string;
}

export type AmbientAct =
  | { kind: "reply"; botId: string; threadId: string; text: string }
  | { kind: "allow" | "deny"; botId: string; threadId: string; requestId: string }
  | { kind: "new-bot" };

export interface IslandLayout {
  surface: "island";
  width: number;
  height: number;
  collapsed: { kind: "notch" | "pill"; width: number; height: number; top: number; notch: number };
  tile: number;
  size: "small" | "medium" | "large";
}

export interface DockLayout {
  surface: "dock";
  width: number;
  height: number;
  body: number;
  top: number;
  dock: { cell: number; tile: number; body: number; pad: number; ear: number; sliver: number; cardRoom: number; spill: number; max: number };
  order: string[];
}

export interface AmbientPrefs {
  available: boolean;
  platform: string;
  island: boolean;
  dock: boolean;
  size: "small" | "medium" | "large";
  display: "active" | "built-in" | "main";
  order: string[];
  displays: Array<{ id: number; internal: boolean; label: string }>;
}

export interface AmbientBridge {
  surface: "island" | "dock" | "";
  onState(cb: (snapshot: AmbientSnapshot) => void): () => void;
  onLayout(cb: (layout: IslandLayout | DockLayout) => void): () => void;
  pointer(on: boolean): void;
  open(botId: string, threadId: string): void;
  act(act: AmbientAct): void;
  order(ids: string[]): void;
  ready(): void;
}

/** The app page's side of it (electron/preload.cjs). */
export interface AmbientAppBridge {
  prefs(): Promise<AmbientPrefs>;
  set(change: Partial<Pick<AmbientPrefs, "island" | "dock" | "size" | "display">>): Promise<AmbientPrefs>;
  wanted(): Promise<boolean>;
  onWanted(cb: (wanted: boolean) => void): () => void;
  publish(snapshot: AmbientSnapshot): void;
  onAct(cb: (act: AmbientAct) => void): () => void;
}

/** The app page's side of electron/desktop-bots.mjs: its working bots for ⌘Q, and the pill a single ⌘Q shows. */
export interface DesktopBotsBridge {
  busy(names: string[]): void;
  onQuitHint(cb: (names: string[]) => void): () => void;
}

declare global {
  interface Window {
    /** The island's and the dock's own bridge (electron/ambient-preload.cjs); absent anywhere else. */
    ambient?: AmbientBridge;
  }
}
