// @vitest-environment happy-dom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { SendKey } from "@/lib/send-key";

const fixture = vi.hoisted(() => ({ sendKey: "enter" as SendKey }));
vi.mock("react-dom", async (importOriginal) => ({ ...await importOriginal<typeof import("react-dom")>(), createPortal: (children: unknown) => children }));
vi.mock("@/lib/send-key", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/send-key")>(),
  useSendKey: () => fixture.sendKey,
}));

import { KeyboardShortcutsModal } from "./KeyboardShortcutsModal";

function keys(html: string, description: string): string[] {
  const row = html.slice(html.indexOf(`>${description}</span>`)).split("</div>")[0]!;
  return [...row.matchAll(/<kbd[^>]*>([^<]*)<\/kbd>/g)].map((match) => match[1]!);
}

describe("KeyboardShortcutsModal", () => {
  it("is Grok's kit dialog: titled, a close button, every group at once, no search and no footer", () => {
    const html = renderToStaticMarkup(createElement(KeyboardShortcutsModal, { open: true, onClose: vi.fn() }));
    expect(html).toContain('role="dialog"');
    expect(html).toMatch(/<h2 id="[^"]+"[^>]*>keyboard shortcuts<\/h2>/i);
    expect(html).toContain('aria-label="close"');
    expect(html).toContain('aria-label="navigation"');
    expect(html).toContain('aria-label="calls"');
    expect(html).not.toContain("Search shortcuts");
    expect(html).not.toContain("Done");
    expect(html).not.toContain("double-click");
    expect(html).not.toContain("from anywhere");
  });

  it.each([
    ["enter", ["Enter"], ["Shift", "Enter"]],
    ["shift-enter", ["Shift", "Enter"], ["Enter"]],
    ["mod-enter", ["Ctrl", "Enter"], ["Enter"]],
  ] as const)("shows the send key chosen in Settings (%s)", (sendKey, send, newLine) => {
    fixture.sendKey = sendKey;
    const html = renderToStaticMarkup(createElement(KeyboardShortcutsModal, { open: true, onClose: vi.fn() }));
    expect(keys(html, "send message")).toEqual(send);
    expect(keys(html, "insert new line without sending")).toEqual(newLine);
    fixture.sendKey = "enter";
  });

  it("does not render when closed", () => {
    expect(renderToStaticMarkup(createElement(KeyboardShortcutsModal, { open: false, onClose: vi.fn() }))).toBe("");
  });
});
