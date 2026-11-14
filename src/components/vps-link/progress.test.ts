import { describe, expect, it } from "vitest";
import type { VpsLinkView } from "@/lib/vps-link";
import { installProgress, vpsProgress } from "./progress";

const steps = (running: VpsLinkView["steps"][number]["progress"]): VpsLinkView["steps"] => [
  { id: "check", status: "done" }, { id: "basics", status: "done" }, { id: "desktop", status: "running", progress: running }, { id: "link", status: "waiting" },
] as VpsLinkView["steps"];

describe("install progress", () => {
  it("is one plain percentage of the whole install, never layers or bytes", () => {
    const view = { stage: "installing", steps: steps({ kind: "layers", completed: 0, total: 13, receivedBytes: 0, totalBytes: 203_000 }) } as unknown as VpsLinkView;
    const shown = vpsProgress(view);
    expect(shown.detail).toBe("50%");
    expect(shown.value).toBe(0.5);
    expect(`${shown.title} ${shown.detail}`).not.toMatch(/layers|KB|\bB of\b|build operations/);
  });

  it("counts the running step's own share", () => {
    const shown = installProgress(steps({ kind: "download", receivedBytes: 50, totalBytes: 100 }), { id: "desktop", status: "running", progress: { kind: "download", receivedBytes: 50, totalBytes: 100 } } as VpsLinkView["steps"][number]);
    expect(shown).toEqual({ detail: "62%", value: 0.625 });
  });
});
