// @vitest-environment happy-dom
// A refused turn another AI takes over, frame by frame: the failed card and limit banner are never painted in between.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { mayTakeOver, RESCUE_GRACE_MS, useRescueGrace } from "./rescue-grace";

type Frame = { busy: boolean; failed: boolean; limited: boolean };

function Dock({ busy, failed, limited, canTakeOver }: Frame & { canTakeOver: boolean }) {
  const rescuing = useRescueGrace(busy, canTakeOver, "bot:thread");
  return createElement("div", null,
    !rescuing && failed ? createElement("div", { "data-failed-reply": "" }) : null,
    !rescuing && limited ? createElement("div", { "data-usage-banner": "danger" }) : null);
}

let root: Root;
let host: HTMLElement;
const painted: string[] = [];
const observer = () => new MutationObserver(() => painted.push(record()));
const record = () => [host.querySelector("[data-failed-reply]") && "failed", host.querySelector("[data-usage-banner]") && "banner"].filter(Boolean).join("+") || "clean";
const show = (frame: Frame, canTakeOver = true) => flushSync(() => root.render(createElement(Dock, { ...frame, canTakeOver })));

beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  painted.length = 0;
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

it("never paints the failed card or the limit banner while a backup takes the refused turn over", () => {
  const watch = observer();
  watch.observe(host, { subtree: true, childList: true });
  show({ busy: true, failed: false, limited: false });
  // Claude refused: the turn ends with its failure and Claude's limit, the backup not started yet
  show({ busy: false, failed: true, limited: true });
  vi.advanceTimersByTime(400);
  show({ busy: false, failed: true, limited: true });
  // the backup's turn starts, then answers
  show({ busy: true, failed: false, limited: false });
  show({ busy: false, failed: false, limited: false });
  vi.advanceTimersByTime(RESCUE_GRACE_MS * 2);
  show({ busy: false, failed: false, limited: false });
  watch.disconnect();
  expect(painted.every((state) => state === "clean"), painted.join(", ")).toBe(true);
  expect(record()).toBe("clean");
});

it("shows the failure once nothing took over within the grace", () => {
  show({ busy: true, failed: false, limited: false });
  show({ busy: false, failed: true, limited: true });
  expect(record()).toBe("clean");
  flushSync(() => vi.advanceTimersByTime(RESCUE_GRACE_MS + 10));
  expect(record()).toBe("failed+banner");
});

it("shows the failure at once with no AI to take over, and on a conversation opened idle", () => {
  show({ busy: true, failed: false, limited: false }, false);
  show({ busy: false, failed: true, limited: false }, false);
  expect(record()).toBe("failed");
  flushSync(() => root.unmount());
  root = createRoot(host);
  show({ busy: false, failed: true, limited: false });
  expect(record()).toBe("failed");
});

it("counts a listed backup or another ready AI as one that may take over", () => {
  const ready = (instanceId: string) => ({ instanceId, snapshot: { state: "available" as const } });
  const claude = { modelSelection: { instanceId: "claude", model: "sonnet" } };
  expect(mayTakeOver(claude, [ready("claude")])).toBe(false);
  expect(mayTakeOver(claude, [ready("claude"), ready("codex")])).toBe(true);
  expect(mayTakeOver({ ...claude, fallback: [{ instanceId: "codex", model: "gpt" }] }, [])).toBe(true);
});
