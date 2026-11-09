import { describe, expect, it, vi } from "vitest";

import { answerBotPointer, botPointerFrom, createBotPointerReporter, parseBotPointer } from "./bot-pointer.ts";

// what Cua Driver 0.37.0 answers get_agent_cursor_state with, on a daemon started with --no-overlay
const state = (enabled: boolean, position: unknown = { x: 1027.0, y: 73.4 }) => ({
  content: [{ type: "text", text: "Agent cursor state for session 'mcp-1'." }],
  structuredContent: { enabled, position, session: "mcp-1", visual_state: { resolved_action: "idle" } },
});

describe("the bot's pointer", () => {
  it("is where the driver's cursor went, only while the driver draws none itself", () => {
    expect(botPointerFrom("click", false, state(false))).toEqual({ x: 1027, y: 73, phase: "click" });
    expect(botPointerFrom("type_text", false, state(false))).toEqual({ x: 1027, y: 73, phase: "move" });
    expect(botPointerFrom("click", false, state(true)), "an old desktop still drawing its own overlay").toBeNull();
    expect(botPointerFrom("get_window_state", false, state(false))).toBeNull();
    expect(botPointerFrom("click", false, state(false, null))).toBeNull();
    expect(botPointerFrom("click", false, state(false, { x: -4, y: 2 }))).toBeNull();
    expect(botPointerFrom("click", false, { isError: true, content: [] })).toBeNull();
  });

  it("follows the desktop's real pointer for a hover, which leaves the agent cursor behind", () => {
    const real = { content: [], structuredContent: { source: "x11", x: 50, y: 700 } };
    expect(botPointerFrom("move_cursor", false, state(false), real)).toEqual({ x: 50, y: 700, phase: "move" });
    expect(botPointerFrom("move_cursor", false, state(true), real)).toBeNull();
    expect(botPointerFrom("move_cursor", false, state(false), { isError: true, content: [] })).toBeNull();
  });

  it("presses nothing when the action was refused", () => {
    expect(botPointerFrom("click", true, state(false))?.phase).toBe("move");
  });

  it("is taken from the bridge only as whole desktop pixels", () => {
    expect(parseBotPointer({ x: 10, y: 20, phase: "click" })).toEqual({ x: 10, y: 20, phase: "click" });
    expect(parseBotPointer({ x: 10.5, y: 20, phase: "click" })).toBeNull();
    expect(parseBotPointer({ x: 10, y: 20, phase: "hover" })).toBeNull();
    expect(parseBotPointer({ x: "10", y: 20, phase: "move" })).toBeNull();
    expect(parseBotPointer([10, 20])).toBeNull();
    const show = vi.fn();
    expect(answerBotPointer({ x: 3, y: 4, phase: "move" }, show)).toEqual([200, { ok: true }]);
    expect(show).toHaveBeenCalledWith({ x: 3, y: 4, phase: "move" });
    expect(answerBotPointer({}, show)[0]).toBe(400);
    expect(show).toHaveBeenCalledTimes(1);
  });

  it("is read on the agent's own connection after the action and posted to the computer-control URL", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}"));
    const reporter = createBotPointerReporter({ url: "http://127.0.0.1:1/api/internal/computer-control?botId=b", token: "t", fetchImpl });
    const child = { call: vi.fn(async () => state(false)), driverVersion: "0.37.0" };
    expect(reporter.wants("click")).toBe(true);
    expect(reporter.wants("screenshot")).toBe(false);
    await reporter.done({ name: "click", arguments: {} }, child, false);
    expect(child.call).toHaveBeenCalledWith("get_agent_cursor_state", {});
    expect(fetchImpl).toHaveBeenCalledWith("http://127.0.0.1:1/api/internal/computer-control?botId=b", expect.objectContaining({
      method: "POST", body: JSON.stringify({ x: 1027, y: 73, phase: "click" }),
      headers: { authorization: "Bearer t", "content-type": "application/json" },
    }));
    child.call.mockResolvedValueOnce(state(true));
    await reporter.done({ name: "click", arguments: {} }, child, false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    child.call.mockResolvedValueOnce(state(false)).mockResolvedValueOnce({ content: [], structuredContent: { source: "x11", x: 5, y: 6 } } as never);
    await reporter.done({ name: "move_cursor", arguments: {} }, child, false);
    expect(child.call).toHaveBeenLastCalledWith("get_cursor_position", {});
    expect(fetchImpl).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({ body: JSON.stringify({ x: 5, y: 6, phase: "move" }) }));
    fetchImpl.mockRejectedValueOnce(new Error("down"));
    await expect(reporter.done({ name: "click", arguments: {} }, child, false)).resolves.toBeUndefined();
  });
});
