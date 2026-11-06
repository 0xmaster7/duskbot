import { Children, createElement, isValidElement, type MouseEvent, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { t } from "@/lib/i18n";
import { AttentionThreadRows, type AttentionThread } from "./SidebarBotActivity";
import { SidebarAttentionPanel } from "./SidebarAttentionPanel";

const entry: AttentionThread = {
  kind: "bot",
  botId: "atlas",
  botName: "Atlas",
  task: { threadId: "approval", title: "Review permission", createdAt: 1, queued: false, activity: "waiting-on-you" },
};

type ElementProps = { children?: ReactNode; onClick?: (event: MouseEvent) => void; [key: string]: unknown };
function findElement(tree: ReactNode, attribute: string, value: string): ReactElement<ElementProps> | undefined {
  for (const child of Children.toArray(tree)) {
    if (!isValidElement<ElementProps>(child)) continue;
    if (child.props[attribute] === value) return child;
    const found = findElement(child.props.children, attribute, value);
    if (found) return found;
  }
}

function renderPanel(
  entries: AttentionThread[] = [entry],
  options: { collapsed?: boolean; onToggle?: () => void } = {},
) {
  let tree: ReactNode;
  const onUnpin = vi.fn();
  const onJump = vi.fn();
  const onToggle = options.onToggle ?? vi.fn();
  function Capture() {
    tree = SidebarAttentionPanel({
      entries,
      onUnpin,
      onJump,
      collapsed: options.collapsed ?? false,
      onToggle,
    });
    return tree;
  }
  const markup = renderToStaticMarkup(createElement(Capture));
  return { markup, tree: () => tree as ReactNode, onUnpin, onJump, onToggle };
}

describe("pinned attention panel", () => {
  it("renders one row per bot under the Active now name, with no thread title", () => {
    const { markup } = renderPanel([entry, { ...entry, task: { ...entry.task, threadId: "older", title: "Older work" } }]);
    expect(markup).toContain("Active now");
    expect(markup).not.toContain("Review permission");
    expect(markup).not.toContain("Older work");
    expect(markup.split('aria-label="Atlas · ').length - 1).toBe(1);
    expect(markup).toContain('data-testid="sidebar-attention-panel"');
    expect(markup).toContain(`aria-label="Atlas · ${t("task.waiting")}"`);
  });

  it("keeps the popover's jump behavior through the shared rows", () => {
    let tree: ReactNode;
    const onJump = vi.fn();
    function Capture() {
      tree = AttentionThreadRows({ entries: [entry], onJump });
      return tree;
    }
    renderToStaticMarkup(createElement(Capture));
    const label = `Atlas · ${t("task.waiting")}`;
    findElement(tree as ReactNode, "aria-label", label)!.props.onClick!({} as MouseEvent);
    expect(onJump).toHaveBeenCalledExactlyOnceWith(entry);
  });

  it("collapses to the header row plus the empty label when nothing is active", () => {
    const { markup } = renderPanel([]);
    expect(markup).toContain("Active now");
    expect(markup).toContain("Nothing active right now");
    expect(markup).not.toContain("Review permission");
  });

  it("unpins from the inline header", () => {
    const { tree, onUnpin } = renderPanel();
    findElement(tree(), "aria-label", "Unpin")!.props.onClick!({} as MouseEvent);
    expect(onUnpin).toHaveBeenCalledOnce();
  });

  it("hides the rows but keeps the header when collapsed", () => {
    const { markup } = renderPanel([entry], { collapsed: true });
    expect(markup).toContain("Active now");
    expect(markup).not.toContain('aria-label="Atlas · ');
    const label = t("sidebar.section.expand", { name: t("attention.active") });
    expect(markup).toContain('aria-label="' + label + '"');
    expect(markup).toContain('aria-expanded="false"');
  });

  it("shows the empty label only when expanded", () => {
    const { markup } = renderPanel([], { collapsed: true });
    expect(markup).not.toContain("Nothing active right now");
  });

  it("toggles from the collapse/expand control", () => {
    const { tree, onToggle } = renderPanel([entry], { collapsed: false });
    const label = t("sidebar.section.collapse", { name: t("attention.active") });
    findElement(tree(), "aria-label", label)!.props.onClick!({} as MouseEvent);
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it("disables collapse when search prevents layout changes", () => {
    const markup = renderToStaticMarkup(createElement(SidebarAttentionPanel, {
      entries: [entry], onUnpin: vi.fn(), onJump: vi.fn(), collapsed: false,
    }));
    expect(markup).toMatch(/<button[^>]+disabled=""[^>]+aria-expanded="true"/);
    expect(markup).toContain('aria-label="Atlas · ');
  });
});
