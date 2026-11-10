import { describe, expect, it } from "vitest";
import { CHECKOUT_SOURCES as MAIN_SOURCES } from "../../electron/cloud-account.mjs";
import { CHECKOUT_SOURCES, checkoutSource } from "../../shared/billing-api";
import type { CloudDesktopStep } from "./cloud-desktop";
import { CLOUD_SOURCES } from "./cloud-plan";
import { cloudMoveStage, MOVE_IN_PROGRESS, moveFollowUp, moveIntended, runsOnHost, runsOnStatus } from "./cloud-move";

const keep = (moved = false) => ({ shown: true, on: false, moved, coming: false });
const view = (step: CloudDesktopStep) => ({ step, acts: true });

describe("where a bot runs", () => {
  it("is the Cloud on its own page, the person's VPS on another server's page, else this computer", () => {
    expect(runsOnHost({ cloudHome: true, otherServer: "box-1", platform: "darwin" })).toEqual({ kind: "cloud", name: null });
    expect(runsOnHost({ cloudHome: false, otherServer: "box-1", platform: "darwin" })).toEqual({ kind: "vps", name: "box-1" });
    expect(runsOnHost({ cloudHome: false, otherServer: null, platform: "darwin" })).toEqual({ kind: "mac", name: null });
    expect(runsOnHost({ cloudHome: false, otherServer: null, platform: "win32" })).toEqual({ kind: "pc", name: null });
  });

  it("is offline without its server, awake while its screen shows or wakes, and asleep otherwise", () => {
    expect(runsOnStatus(false, "screen")).toBe("offline");
    expect(runsOnStatus(true, "screen")).toBe("awake");
    expect(runsOnStatus(true, "loading")).toBe("awake");
    expect(runsOnStatus(true, "asleep")).toBe("asleep");
    expect(runsOnStatus(true, "off")).toBe("asleep");
    expect(runsOnStatus(true, null)).toBe("asleep");
  });
});

describe("the move to Cloud desktop", () => {
  it("goes through checkout, setup, one tap, the move, and back, in that order of stages", () => {
    expect(cloudMoveStage(null, null)).toBe("elsewhere");
    const stages: Array<[CloudDesktopStep, ReturnType<typeof cloudMoveStage>]> = [
      ["get", "buy"], ["finish", "resume"], ["setup", "preparing"], ["waking", "preparing"], ["move", "ready"], ["moving", "moving"],
      ["back", "moved"], ["coming-back", "coming-back"], ["manage", "manage"], ["other", "manage"],
    ];
    for (const [step, stage] of stages) expect(cloudMoveStage(view(step), keep()), step).toBe(stage);
    expect(cloudMoveStage(view("open"), keep(true))).toBe("moved");
    expect(cloudMoveStage(view("open"), keep(false))).toBe("open");
    expect(cloudMoveStage(view("open"), null)).toBe("open");
  });

  it("offers no button that starts something while it goes on by itself", () => {
    expect([...MOVE_IN_PROGRESS].sort()).toEqual(["coming-back", "moving", "preparing"]);
  });

  it("after a checkout asked for here, moves once the Cloud is ready and forgets the ask once the bots are there", () => {
    expect(moveFollowUp("ready", true)).toBe("move");
    expect(moveFollowUp("ready", false)).toBeNull();
    for (const stage of ["buy", "resume", "preparing", "moving", "manage", "elsewhere"] as const) expect(moveFollowUp(stage, true), stage).toBeNull();
    expect(moveFollowUp("moved", true)).toBe("clear");
    expect(moveFollowUp("open", true)).toBe("clear");
  });

  it("keeps that ask a day, never one from the future or unreadable", () => {
    const now = 1_000_000_000;
    expect(moveIntended(String(now - 1000), now)).toBe(true);
    expect(moveIntended(String(now - 25 * 3600_000), now)).toBe(false);
    expect(moveIntended(String(now + 1000), now)).toBe(false);
    expect(moveIntended(null, now)).toBe(false);
    expect(moveIntended("soon", now)).toBe(false);
  });

  it("records its checkouts as app_computer_move in the app, in main and in the funnel", () => {
    expect(CLOUD_SOURCES).toContain("app_computer_move");
    expect(MAIN_SOURCES).toContain("app_computer_move");
    expect(CHECKOUT_SOURCES).toContain("app_computer_move");
    expect(checkoutSource("app_computer_move")).toBe("app_computer_move");
    // every source the app sends is one main lets through and the funnel keeps by name
    for (const source of CLOUD_SOURCES) {
      expect(MAIN_SOURCES, source).toContain(source);
      expect(checkoutSource(source), source).toBe(source);
    }
  });
});
