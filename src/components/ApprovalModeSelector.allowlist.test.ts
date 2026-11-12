import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApprovalMode } from "../../shared/approval-mode";

const fixture = vi.hoisted(() => ({ open: false }));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: () => [fixture.open, (next: boolean | ((current: boolean) => boolean)) => {
    fixture.open = typeof next === "function" ? next(fixture.open) : next;
  }],
}));
import { ApprovalModeSelector } from "./ApprovalModeSelector";

type Node = ReactElement<{ children?: ReactNode; role?: string; onClick?: () => void; disabled?: boolean; "aria-haspopup"?: string }>;
function nodes(value: ReactNode): Node[] {
  if (!isValidElement(value)) return [];
  const node = value as Node;
  return [node, ...Children.toArray(node.props.children).flatMap(nodes)];
}
function render(onSelect: (mode: ApprovalMode) => void, onManageCommandAllowlist?: () => void, trustedModesAvailable = true, busy = false) {
  let tree: ReactNode;
  function Capture() {
    tree = ApprovalModeSelector({ providerName: "Codex", driverKind: "codex", approvalMode: "ask", onSelect, onManageCommandAllowlist, trustedModesAvailable, busy });
    return tree;
  }
  return { html: renderToStaticMarkup(createElement(Capture)), nodes: nodes(tree) };
}
beforeEach(() => { fixture.open = false; });

describe("command allowlist menu access", () => {
  it("places the management action after Full access and opens it without changing approval mode", () => {
    const select = vi.fn(), manage = vi.fn();
    render(select, manage).nodes.find((node) => node.props["aria-haspopup"] === "menu")!.props.onClick!();
    const open = render(select, manage);
    expect(open.html.indexOf("full access")).toBeLessThan(open.html.indexOf("command allowlist"));
    expect(open.html.indexOf("command allowlist")).toBeLessThan(open.html.indexOf("custom (config.toml)"));
    open.nodes.find((node) => node.props.role === "menuitem")!.props.onClick!();
    expect(manage).toHaveBeenCalledOnce();
    expect(select).not.toHaveBeenCalled();
    expect(render(select, manage).html).not.toContain('role="menu"');
  });

  it("leaves Full access selection on its existing callback", () => {
    const select = vi.fn(), manage = vi.fn();
    fixture.open = true;
    const full = render(select, manage).nodes.filter((node) => node.props.role === "menuitemradio")
      .find((node) => renderToStaticMarkup(node).includes("full access"))!;
    full.props.onClick!();
    expect(select).toHaveBeenCalledExactlyOnceWith("full");
    expect(manage).not.toHaveBeenCalled();
  });

  it("offers Full access without the desktop bridge and sends only Custom to the desktop app", () => {
    const select = vi.fn();
    fixture.open = true;
    const open = render(select, undefined, false);
    expect(open.html).not.toContain("custom (config.toml)");
    expect(open.html).toContain("custom approval must be changed in the local packaged desktop app.");
    expect(open.html).not.toContain("Full and Custom are available in the packaged desktop app.");
    open.nodes.filter((node) => node.props.role === "menuitemradio")
      .find((node) => renderToStaticMarkup(node).includes("full access"))!.props.onClick!();
    expect(select).toHaveBeenCalledExactlyOnceWith("full");
  });

  it("offers the action without trusted modes, and omits it when the caller lacks management authority", () => {
    fixture.open = true;
    expect(render(vi.fn(), vi.fn(), false).html).toContain("command allowlist");
    expect(render(vi.fn()).html).not.toContain("command allowlist");
  });

  it("keeps every level selectable while the bot works, and says from when a change applies", () => {
    const select = vi.fn();
    const trigger = render(select, undefined, true, true).nodes.find((node) => node.props["aria-haspopup"] === "menu")!;
    expect(trigger.props.disabled).toBeUndefined();
    trigger.props.onClick!();
    const open = render(select, undefined, true, true);
    expect(open.html).toContain("the bot is working. a change applies from its next step");
    const modes = open.nodes.filter((node) => node.props.role === "menuitemradio");
    expect(modes.length).toBeGreaterThan(0);
    expect(modes.every((mode) => !mode.props.disabled)).toBe(true);
    modes.find((node) => renderToStaticMarkup(node).includes("full access"))!.props.onClick!();
    expect(select).toHaveBeenCalledExactlyOnceWith("full");
    fixture.open = true;
    expect(render(select).html).not.toContain("the bot is working");
  });
});
