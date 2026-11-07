import { describe, expect, it } from "vitest";
import { SANDBOX_DRIVER_INSTRUCTIONS, sandboxComputerResultLine } from "./sandbox-computer-guidance.ts";

const frame = (result: unknown) => JSON.stringify({ jsonrpc: "2.0", id: 7, result });
const parse = (line: string) => JSON.parse(line) as { id: number; result: Record<string, unknown> };

describe("the VPS desktop's driver, as the bot sees it", () => {
  it("lists only tools that work here: no typed browser tools that always refuse, no driver upkeep", () => {
    const names = ["get_window_state", "click", "run_steps", "get_browser_state", "browser_prepare", "browser_click", "page", "health_report", "get_config", "launch_app"];
    const line = sandboxComputerResultLine(frame({ tools: names.map((name) => ({ name, description: name, inputSchema: { type: "object" } })) }));
    const listed = (parse(line).result.tools as Array<{ name: string }>).map((tool) => tool.name);
    expect(listed).toEqual(["get_window_state", "click", "run_steps", "launch_app"]);
    expect(parse(line).id).toBe(7);
  });
  it("replaces instructions that send the model to refused browser tools and forbid pointer input", () => {
    const line = sandboxComputerResultLine(frame({ protocolVersion: "2025-06-18", serverInfo: { name: "cua-driver" }, capabilities: {}, instructions: "No shell. Chrome/Edge/Brave page: get_browser_state ... never desktop pointer tools." }));
    const instructions = String(parse(line).result.instructions);
    expect(instructions).toBe(SANDBOX_DRIVER_INSTRUCTIONS);
    expect(instructions).toContain("vm_exec");
    expect(instructions).not.toMatch(/never desktop pointer|No shell/);
  });
  it("turns a browser consent refusal into a next step, without the original's dead-end hint", () => {
    const result = {
      content: [{ type: "text", text: "refused (browser_consent_required): requires --grant existing-profile" }],
      structuredContent: { hint: "ask the user to authorize it", next_call: { tool: "browser_prepare" }, refusal: { code: "browser_consent_required", message: "Call browser_prepare" } },
    };
    const out = parse(sandboxComputerResultLine(frame(result))).result;
    expect(out.isError).toBe(true);
    expect(out.structuredContent).toBeUndefined();
    const text = (out.content as Array<{ text: string }>)[0]!.text;
    expect(text).toContain("do not call browser_prepare again");
    expect(text).not.toMatch(/--grant|existing-profile/);
  });
  it("passes every other frame through byte for byte", () => {
    const lines = [
      frame({ content: [{ type: "text", text: "Clicked" }] }),
      frame({ tools: [{ name: "click" }] }),
      "not json with \"tools\"",
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/progress", params: { instructions: "x" } }),
    ];
    for (const line of lines) expect(sandboxComputerResultLine(line)).toBe(line);
  });
});
