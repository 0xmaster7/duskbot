export interface DesktopNotificationNote {
  title: string;
  body: string;
  tag?: string;
  silent?: boolean;
  /** The bot's picture, on the page's own origin. */
  picture?: string;
  botId: string;
  threadId: string;
  /** An approval or a question: the banner closes once the bot stops waiting on the person. */
  ask?: boolean;
}

export interface DesktopNotificationsBridge {
  /** Resolves false when main shows nothing (no system support, or not this window's page): the page shows its own. */
  show(note: DesktopNotificationNote): Promise<boolean>;
  /** A click on one of them brought this page up: open that thread. */
  onOpen(cb: (target: { botId: string; threadId: string }) => void): () => void;
  /** Which of this page's loaded bots wait on the person now, and which do not; absent before this app had it. */
  asks?(report: { waiting: string[]; settled: string[] }): void;
}
