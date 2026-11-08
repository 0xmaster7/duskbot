import { describe, expect, it } from "vitest";
import type { AppEntry } from "@/components/connect-apps/catalog";
import { appIsAdded } from "./ConnectorsSheet";
import { routineResultsThread } from "./RoutinesSheet";
import { swipeOffset, swipeRestingPosition } from "./SwipeRow";

describe("swipe row release", () => {
  it("uses the flick direction to open or close beyond the midpoint", () => {
    expect(swipeRestingPosition(-20, -300, 132)).toBe(-132);
    expect(swipeRestingPosition(-100, 300, 132)).toBe(0);
    expect(swipeRestingPosition(-65, 0, 132)).toBe(0);
    expect(swipeRestingPosition(-67, 0, 132)).toBe(-132);
  });

  it("tracks the finger inside its bounds and limits overshoot at either edge", () => {
    expect(swipeOffset(-70, 132)).toBe(-70);
    expect(swipeOffset(-132, 132)).toBe(-132);
    expect(swipeOffset(0, 132)).toBe(0);
    expect(swipeOffset(-1000, 132)).toBeGreaterThan(-180);
    expect(swipeOffset(-1000, 132)).toBeLessThan(-132);
    expect(swipeOffset(1000, 132)).toBeGreaterThan(0);
    expect(swipeOffset(1000, 132)).toBeLessThan(48);
  });
});

describe("merged app connections", () => {
  const entry: AppEntry = { id: "notion", kind: "remote", label: "Notion", description: "", categories: [], icon: {}, composio: "notion_mcp", remote: "notion-remote", aliases: ["notion_io"] };

  it("recognises each provider and alias as the same connected app", () => {
    for (const id of ["notion", "notion_mcp", "notion-remote", "notion_io"]) expect(appIsAdded(entry, new Set([id]))).toBe(true);
  });

  it("does not treat a different app or an empty inventory as connected", () => {
    expect(appIsAdded(entry, new Set(["slack"]))).toBe(false);
    expect(appIsAdded(entry, new Set())).toBe(false);
  });
});

describe("routine results navigation", () => {
  const bot = { threadId: "current-task", mainThreadId: "main-chat" };

  it("opens the configured results thread before the bot's main conversation", () => {
    expect(routineResultsThread({ resultsThreadId: "reports" }, bot)).toBe("reports");
    expect(routineResultsThread({}, bot)).toBe("main-chat");
  });

  it("falls back to the current conversation when there is no main thread", () => {
    expect(routineResultsThread({}, { threadId: "current-task" })).toBe("current-task");
  });
});
