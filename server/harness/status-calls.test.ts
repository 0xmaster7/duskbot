import { describe, expect, it } from "vitest";

import { STATUS_LABEL_MAX } from "../../shared/turn-progress.ts";
import { isStatusToolName, statusCallText, statusLabel } from "./status-calls.ts";

describe("statusLabel", () => {
  it("reads the bot's words as a status line label", () => {
    expect(statusLabel("is parsing python repos")).toBe("Parsing python repos");
    expect(statusLabel("  comparing keyboard reviews... ")).toBe("Comparing keyboard reviews");
    expect(statusLabel("Building slides 4-6…")).toBe("Building slides 4-6");
    expect(statusLabel("checking\nthe\tflights!")).toBe("Checking the flights");
    expect(statusLabel("   ")).toBeUndefined();
    expect(statusLabel("...")).toBeUndefined();
    expect(statusLabel(undefined)).toBeUndefined();
  });

  it("cuts a long one at a word, within the limit", () => {
    const label = statusLabel("researching the history of mechanical keyboards in great depth for the report")!;
    expect(label.length).toBeLessThanOrEqual(STATUS_LABEL_MAX);
    expect(label).toBe("Researching the history of mechanical");
    expect(statusLabel("x".repeat(90))).toBe("X".padEnd(STATUS_LABEL_MAX, "x"));
  });

  it("never carries a credential", () => {
    const label = statusLabel("testing key sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789")!;
    expect(label).not.toContain("abcdefghijklmnopqrstuvwxyz0123456789");
  });
});

describe("statusCallText", () => {
  const status = JSON.stringify({ status: "comparing keyboard reviews" });

  it("reads the call under every engine's spelling", () => {
    for (const title of ["set_status", "mcp__agents__set_status", "agents__set_status", "agents_set_status", "mcp__omb-agents__set_status"]) {
      expect(statusCallText(title, status)).toBe("comparing keyboard reviews");
      expect(isStatusToolName(title)).toBe(true);
    }
    expect(statusCallText("set_status", { status: "raw args" })).toBe("raw args");
  });

  it("reads a call through the bridge's use_tool, whole or cut short", () => {
    const bridged = JSON.stringify({ name: "set_status", arguments: { status: "drafting the trip files" } }, null, 2);
    expect(statusCallText("mcp__agents__use_tool", bridged)).toBe("drafting the trip files");
    expect(statusCallText("use_tool", `${bridged.slice(0, bridged.indexOf("trip") + 4)}`)).toBe("drafting the trip");
    expect(statusCallText("use_tool", JSON.stringify({ name: "list_bots", arguments: {} }))).toBeNull();
  });

  it("is null for any other call, and undefined for a status call naming none", () => {
    expect(statusCallText("Bash", JSON.stringify({ command: "echo hi" }))).toBeNull();
    expect(statusCallText("set_statuses", status)).toBeNull();
    expect(isStatusToolName("Bash")).toBe(false);
    expect(statusCallText("set_status", "{}")).toBeUndefined();
  });
});
