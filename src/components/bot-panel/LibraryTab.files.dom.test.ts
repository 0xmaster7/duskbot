// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Bot, Message } from "@/state/store";

vi.mock("@/state/store", async (original) => ({ ...await original<typeof import("@/state/store")>(), useStore: () => ({ dispatch: vi.fn() }) }));
vi.mock("@/lib/page-open", () => ({ usePageOpener: () => vi.fn() }));
vi.mock("@/lib/use-media-query", () => ({ SIDEBAR_INLINE: "", useMediaQuery: () => true }));
const { LibraryPage } = await import("./LibraryTab");
let host: HTMLDivElement;
let root: Root;
const bot = (threadId = "thread-1", paths = ["/workspace/report.md", "/home/cua/.cache/state.bin"]): Bot => ({
  id: "fixture", name: "Fixture", threadId, cwd: "/workspace", messages: [{
    id: "digest", role: "bot", kind: "digest", at: Date.now(), digest: { files: { added: paths, changed: [], deleted: [] } },
  } as unknown as Message],
} as Bot);
const render = async (value: Bot) => { await act(async () => root.render(createElement(LibraryPage, { bot: value }))); };
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it("defaults to work files, reveals automatic system rows on request, and resets for another conversation", async () => {
  await render(bot());
  expect(host.textContent).toContain("report.md");
  expect(host.textContent).not.toContain("state.bin");
  const toggle = host.querySelector<HTMLButtonElement>('[aria-pressed="false"]')!;
  expect(toggle.textContent).toBe("Show system files");
  await act(async () => toggle.click());
  expect(host.textContent).toContain("state.bin");
  expect(host.querySelector('[aria-pressed="true"]')?.textContent).toBe("Hide system files");
  await render(bot("thread-2"));
  expect(host.textContent).not.toContain("state.bin");
  expect(host.querySelector('[aria-pressed="false"]')).not.toBeNull();
  expect(fetch).not.toHaveBeenCalled();
});

it("does not offer a system toggle when only ordinary work files exist", async () => {
  await render(bot("thread-1", ["/workspace/.github/ci.yml", "/workspace/.gitignore", "/home/cua/Downloads/report.pdf"]));
  expect(host.querySelector("[aria-pressed]")).toBeNull();
  expect(host.textContent).toContain(".gitignore");
  expect(host.textContent).toContain("report.pdf");
});
