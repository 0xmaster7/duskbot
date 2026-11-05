import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { SidebarSectionHeader } from "./SidebarSectionHeader";

describe("SidebarSectionHeader", () => {
  it("exposes collapse and keyboard reorder semantics without a fake grip button", () => {
    const html = renderToStaticMarkup(
      createElement(SidebarSectionHeader, {
        name: "Work",
        collapsed: false,
        onToggle: () => {},
        reorderable: true,
        dragging: false,
      }),
    );

    expect(html).toContain("<button");
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain('role="button"');
    expect(html).not.toContain("Delete Work department");
    expect(html.indexOf(">Work</span>")).toBeLessThan(html.indexOf("lucide-chevron-down"));
    expect(html).not.toContain("uppercase");
  });

  it.each([false, true])("keeps delete separate from collapse and the context menu, collapsed=%s", (collapsed) => {
    const onContextMenu = () => {};
    const element = SidebarSectionHeader({
      name: "Work",
      collapsed,
      onToggle: () => {},
      onDelete: () => {},
      onContextMenu,
      reorderable: true,
      dragging: false,
    });
    const html = renderToStaticMarkup(element);

    expect(element.props.onContextMenu).toBe(onContextMenu);
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain('aria-label="Delete Work department"');
    expect(html).toContain(`aria-expanded="${!collapsed}"`);
    expect(html.match(/<button\b/g)).toHaveLength(2);
    expect(html.indexOf("</button>")).toBeLessThan(html.indexOf('aria-label="Delete Work department"'));
  });

  it("renders collapsed attention signals in the heading", () => {
    const html = renderToStaticMarkup(
      createElement(SidebarSectionHeader, {
        name: "Bot Chats",
        collapsed: true,
        attention: { waiting: 1, unread: 2, working: 1 },
        onToggle: () => {},
        reorderable: false,
        dragging: false,
      }),
    );

    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("1 waiting for you");
    expect(html).toContain("2 unread");
    expect(html).toContain("1 working");
  });

  it("retains the accessible attention summary when the heading cannot collapse", () => {
    const html = renderToStaticMarkup(
      createElement(SidebarSectionHeader, {
        name: "Bot Chats",
        collapsed: false,
        attention: { waiting: 1, unread: 2, working: 1 },
        reorderable: false,
        dragging: false,
      }),
    );

    expect(html).not.toContain("<button");
    expect(html).toContain('class="sr-only"');
    expect(html).toContain("1 waiting for you");
    expect(html).toContain("2 unread");
    expect(html).toContain("1 working");
  });
});

type Props = { children?: ReactNode; [key: string]: unknown };
function nodes(value: ReactNode): ReactElement<Props>[] {
  return Children.toArray(value).flatMap((child) => {
    if (!isValidElement<Props>(child)) return [];
    return [child, ...nodes(child.props.children)];
  });
}

describe("SidebarSectionHeader as a Simple-mode line", () => {
  const line = (props: Partial<Parameters<typeof SidebarSectionHeader>[0]> = {}) => SidebarSectionHeader({
    name: "Work", collapsed: false, onToggle: () => {}, reorderable: true, dragging: false, line: true, ...props,
  }) as ReactElement<Props>;

  it("draws a quiet 13px name with no hairline, and a ⋯ team menu button out of the line's flow for the keyboard, with no trash or grip", () => {
    const onMenu = vi.fn();
    const element = line({ onMenu, onDelete: () => {} });
    const html = renderToStaticMarkup(element);
    expect(html).toContain('data-sidebar-section-line=""');
    expect(html).toMatch(/text-\[13px\][^"]*text-ink-secondary/);
    expect(html).not.toContain("bg-hairline");
    expect(html).toContain('aria-label="Actions for Work department" title="Actions for Work department" aria-haspopup="menu" aria-expanded="false"');
    expect(html).toMatch(/aria-label="Actions for Work department"[^>]*class="absolute [^"]*\bpointer-events-none\b[^"]*\bopacity-0\b[^"]*\bgroup-has-\[:focus-visible\]\/section:opacity-100\b[^"]*\btouch:opacity-100\b/);
    expect(html).not.toMatch(/aria-label="Actions for Work department"[^>]*class="[^"]*\bgroup-hover\//);
    expect(html).not.toContain("Delete Work department");
    expect(html).not.toContain("lucide-grip-vertical");
    expect(html).not.toContain("lucide-trash");
    expect(html).toMatch(/<span class="absolute flex h-4 w-3 items-center justify-center text-ink-secondary opacity-0 transition-opacity duration-\[120ms\] ease-out group-hover\/section:opacity-100 group-focus-within\/section:opacity-100 touch:opacity-100 -right-px rotate-90"><i class="grok-icon" data-icon-name="chevron-right"/);
    expect(html.indexOf(">Work</span>")).toBeLessThan(html.indexOf("Actions for Work department"));
    const button = { id: "dots" };
    const dots = nodes(element.props.children).find((node) => node.props["aria-label"] === "Actions for Work department")!;
    (dots.props.onClick as (event: { currentTarget: unknown }) => void)({ currentTarget: button });
    expect(onMenu).toHaveBeenCalledExactlyOnceWith(button);
    expect(renderToStaticMarkup(line({ onMenu, menuOpen: true }))).toContain('aria-haspopup="menu" aria-expanded="true"');
    expect(renderToStaticMarkup(line())).not.toContain("Actions for Work department");
  });

  it("shows how many rows a collapsed section holds, crossfading to the chevron on hover or focus, and no count while open", () => {
    expect(renderToStaticMarkup(line({ count: 3 }))).not.toContain(">3</span>");
    const html = renderToStaticMarkup(line({ count: 3, collapsed: true }));
    expect(html).toMatch(/class="h-\[30px\]|group\/section relative flex h-\[30px\] shrink-0 items-center gap-1\.5 rounded-\[6px\] px-2 pb-1\.5 pt-2 hover:bg-\[color-mix\(in_srgb,var\(--color-raised\)_75%,var\(--color-panel\)\)\]/);
    expect(html).toMatch(/<span class="text-\[13px\] tabular-nums leading-\[18px\] tracking-\[0.015em\] text-ink-secondary transition-opacity duration-\[120ms\] ease-out group-hover\/section:opacity-0 group-focus-within\/section:opacity-0 touch:opacity-0">3<\/span>/);
  });

  it("is dragged by the line itself, and only when it can be reordered", () => {
    const onDragStart = vi.fn();
    const onDragEnd = vi.fn();
    const movable = line({ onDragStart, onDragEnd });
    expect(movable.props.draggable).toBe(true);
    expect(movable.props.onDragStart).toBe(onDragStart);
    expect(movable.props.onDragEnd).toBe(onDragEnd);
    expect(String(movable.props.className)).toContain("cursor-grab");
    const fixed = line({ reorderable: false, onDragStart, onDragEnd });
    expect(fixed.props.draggable).toBeUndefined();
    expect(fixed.props.onDragStart).toBeUndefined();
    expect(String(line({ dragging: true }).props.className)).toContain("opacity-40");
  });

  it("collapses from the name, keeps Alt+Arrow reordering and the right-click menu", () => {
    const onToggle = vi.fn();
    const onMove = vi.fn();
    const onContextMenu = vi.fn();
    const element = line({ onToggle, onMove, onContextMenu });
    expect(element.props.onContextMenu).toBe(onContextMenu);
    const name = nodes(element.props.children).find((node) => node.type === "button")!;
    expect(name.props["aria-keyshortcuts"]).toBe("Alt+ArrowUp Alt+ArrowDown");
    (name.props.onClick as () => void)();
    expect(onToggle).toHaveBeenCalledOnce();
    const keyDown = name.props.onKeyDown as (event: { altKey: boolean; key: string; preventDefault: () => void }) => void;
    keyDown({ altKey: true, key: "ArrowUp", preventDefault: () => {} });
    keyDown({ altKey: true, key: "ArrowDown", preventDefault: () => {} });
    keyDown({ altKey: false, key: "ArrowDown", preventDefault: () => {} });
    expect(onMove.mock.calls).toEqual([[-1], [1]]);
  });

  it("shows a collapsed line's chevron and attention badges", () => {
    const html = renderToStaticMarkup(line({ collapsed: true, attention: { waiting: 1, unread: 2, working: 1 } }));
    expect(html).toContain('aria-expanded="false"');
    expect(html).toMatch(/-right-\[3px\]"><i class="grok-icon" data-icon-name="chevron-right"/);
    expect(html).toContain("1 waiting for you");
    expect(html).toContain("2 unread");
    expect(html).toContain("1 working");
    expect(renderToStaticMarkup(line())).toContain("-right-px rotate-90");
  });
});
