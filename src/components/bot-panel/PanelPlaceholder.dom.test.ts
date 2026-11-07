// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../Avatar", () => ({ BotAvatar: (props: { bot: { name: string } }) => createElement("span", { "data-stub-avatar": props.bot.name }) }));
vi.mock("./PanelShell", () => ({ PanelDetailsTab: { preload: () => Promise.resolve() }, PanelAdvancedTab: { preload: () => Promise.resolve() } }));

const saved = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => saved.get(key) ?? null,
  setItem: (key: string, value: string) => void saved.set(key, value),
  clear: () => saved.clear(),
});

const { PanelPlaceholder, readPanelBot, rememberPanelBot } = await import("./PanelPlaceholder");

afterEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
});

function mount(onClose = () => {}) {
  const host = document.createElement("div");
  document.body.append(host);
  flushSync(() => createRoot(host).render(createElement(PanelPlaceholder, { onClose })));
  return host;
}

describe("PanelPlaceholder", () => {
  it("draws the bot the panel last showed while the bots load", () => {
    rememberPanelBot({ id: "b1", name: "Tally", color: "green", mascotBody: null, mascotFaceColor: null });
    expect(readPanelBot()).toEqual({ id: "b1", name: "Tally", color: "green", mascotBody: null, mascotFaceColor: null });
    const host = mount();
    const panel = host.querySelector("[data-panel-placeholder]")!;
    expect(panel.getAttribute("aria-busy")).toBe("true");
    expect(panel.getAttribute("aria-label")).toBe("Tally");
    expect(host.querySelector("[data-stub-avatar]")?.getAttribute("data-stub-avatar")).toBe("Tally");
  });

  it("falls back to placeholders with nothing remembered, and closes", () => {
    localStorage.setItem("openmausbot.botPanelLast.v1", "{broken");
    expect(readPanelBot()).toBeNull();
    const onClose = vi.fn();
    const host = mount(onClose);
    expect(host.querySelector("[data-stub-avatar]")).toBeNull();
    host.querySelector<HTMLButtonElement>("button[aria-label]")!.click();
    expect(onClose).toHaveBeenCalledOnce();
  });
});
