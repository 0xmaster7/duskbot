import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (name: string) => readFileSync(new URL(`./${name}`, import.meta.url), "utf8");

function expectDirAuto(file: string, marker: string) {
  const text = source(file);
  const at = text.indexOf(marker);
  expect(at, `${file} missing ${marker}`).toBeGreaterThan(-1);
  const window = text.slice(Math.max(0, at - 280), at + marker.length);
  expect(window, `${file} near ${marker}`).toContain('dir="auto"');
}

describe("chat text follows the writer's direction", () => {
  it("sets dir=auto on the chat inputs and previews that were still forced ltr", () => {
    expectDirAuto("BubbleEditor.tsx", "value={draft}");
    expectDirAuto("AskCard.tsx", "value={value}");
    expectDirAuto("ChatFindBar.tsx", "value={query}");
    expectDirAuto("RawMarkdownToggle.tsx", 'data-testid="raw-markdown-view"');
    expectDirAuto("RoomBulletin.tsx", "value={bulletin.draft}");
    expectDirAuto("RoomBulletin.tsx", "group.bulletin.split");
    expectDirAuto("room-panel/RoomModals.tsx", "value={draft}");
    expectDirAuto("SearchResults.tsx", "line-clamp-2");

    const pins = [source("ChatPinnedBanner.tsx"), source("GroupView.tsx")].map((text) => text.includes('dir="auto" className="truncate text-[13px] text-ink-secondary"'));
    expect(pins).toEqual([true, true]);
  });
});
