// What a conversation's browser work leaves in its chat and its browser: the bot's own screenshots, posted into the chat,
// and the conversation's tabs, closed a little after its task ends.
import { screenFrameHash } from "../screen-frame-gate.ts";

type Image = { type: "image"; data: string; mimeType: string };
type From = { botId: string; name: string; color: string };

export interface BrowserChatDeps {
  postScreen(threadId: string, frame: { png: string; mime: string; from?: From }): void;
  /** True while the conversation runs a turn or its work waits on the person (an open sign-in, approval or question). */
  stillNeeded(botId: string, threadId: string): boolean;
  /** The conversation's browser while it runs, else null. */
  runningSession(botId: string, threadId: string): string | null;
  closeThreadTabs(session: string, threadId: string): Promise<"closed" | "kept" | "none">;
  graceMs?: number;
}

const SCREENSHOTS_PER_TURN = 4;
const CLOSE_TRIES = 30;

export function createBrowserChat(deps: BrowserChatDeps) {
  const graceMs = deps.graceMs ?? 2 * 60_000;
  const usedInTurn = new Set<string>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const shots = new Map<string, { generation: string; count: number; hash: string }>();

  /** Two minutes after the turn, unless it still waits on the person; kept and tried again while someone watches. */
  const closeLater = (botId: string, threadId: string, tries = 0): void => {
    clearTimeout(timers.get(threadId));
    const timer = setTimeout(() => {
      timers.delete(threadId);
      if (deps.stillNeeded(botId, threadId)) return;
      const session = deps.runningSession(botId, threadId);
      if (!session) return;
      void deps.closeThreadTabs(session, threadId).then((outcome) => {
        if (outcome === "closed") console.info(`browser ${session}: closed the tabs of a finished conversation`);
        if (outcome === "kept" && tries < CLOSE_TRIES) closeLater(botId, threadId, tries + 1);
      }, () => {});
    }, graceMs);
    timer.unref?.();
    timers.set(threadId, timer);
  };

  return {
    used(threadId: string): void { usedInTurn.add(threadId); },
    turnEnded(botId: string, threadId: string): void { if (usedInTurn.delete(threadId)) closeLater(botId, threadId); },
    /** Up to four a turn, never the same picture twice in a row. */
    screenshot(threadId: string, generation: string, result: unknown, from?: From): void {
      const content = (result as { isError?: boolean; content?: unknown } | null)?.isError ? null : (result as { content?: unknown } | null)?.content;
      const images = Array.isArray(content) ? content.filter((part): part is Image => part?.type === "image" && typeof part.data === "string"
        && part.data.length > 0 && (part.mimeType === "image/png" || part.mimeType === "image/jpeg")) : [];
      for (const image of images) {
        const prior = shots.get(threadId);
        const turn = prior?.generation === generation ? prior : { generation, count: 0, hash: "" };
        if (turn.count >= SCREENSHOTS_PER_TURN) return;
        const hash = screenFrameHash(image.data);
        if (hash === turn.hash) continue;
        deps.postScreen(threadId, { png: image.data, mime: image.mimeType, ...(from ? { from } : {}) });
        shots.set(threadId, { generation, count: turn.count + 1, hash });
      }
    },
    postedScreenshot(threadId: string, generation: string | undefined): boolean {
      return Boolean(generation) && shots.get(threadId)?.generation === generation;
    },
  };
}
