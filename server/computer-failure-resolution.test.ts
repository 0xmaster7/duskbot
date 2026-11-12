import { describe, expect, it } from "vitest";
import type { WireMessage } from "../shared/wire.ts";
import { computerFailuresToResolve, computerFixesPlace } from "./computer-failure-resolution.ts";

const row = (id: string, tool: Partial<NonNullable<WireMessage["tool"]>>): WireMessage => ({
  id, role: "bot", kind: "activity", at: 1, tool: { name: "error: the computer did not start", ok: false, ...tool },
} as WireMessage);
const place = (state: "place-failed" | "cc-no-start" | "cc-needs-key" | "browser-off") => ({ state, params: {}, source: "works-on" as const });

describe("computer failures a ready computer resolves", () => {
  it("picks unresolved computer place failures only", () => {
    const rows = [
      row("vps", { place: place("place-failed") }),
      row("start", { place: place("cc-no-start") }),
      row("key", { place: place("cc-needs-key") }),
      row("browser", { place: place("browser-off") }),
      row("done", { place: place("place-failed"), resolvedAt: 5 }),
      row("plain", {}),
      row("tool", { name: "bash", ok: false, place: place("place-failed") }),
    ];
    expect(computerFailuresToResolve(rows).map((m) => m.id)).toEqual(["vps", "start"]);
  });

  it("reads only the thread's tail", () => {
    const rows = [row("old", { place: place("place-failed") }), ...Array.from({ length: 3 }, (_, i) => row(`x${i}`, {}))];
    expect(computerFailuresToResolve(rows, 3)).toEqual([]);
  });

  it("keeps a sign-in or key problem, which a ready computer does not fix", () => {
    expect(computerFixesPlace("cc-needs-key")).toBe(false);
    expect(computerFixesPlace("vps")).toBe(true);
  });
});
