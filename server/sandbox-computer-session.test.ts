import { describe, expect, it } from "vitest";
import { createSandboxComputerSession, REPEAT_LIMIT, runStepsThroughDialogs, SAME_FRAME_MS } from "./sandbox-computer-session.ts";

const call = (id: number, name: string, args: Record<string, unknown> = {}) =>
  JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });
const answer = (id: number, content: unknown[], extra: Record<string, unknown> = {}) =>
  JSON.stringify({ jsonrpc: "2.0", id, result: { content, ...extra } });
const shot = (data: string) => [{ type: "text", text: "window_id=7" }, { type: "image", mimeType: "image/png", data }];
const sent = (line: string) => JSON.parse(line).params.arguments as Record<string, unknown>;
const parts = (line: string) => JSON.parse(line).result.content as Array<{ type: string; text?: string }>;

function clock(start = 1_000) {
  let at = start;
  return { now: () => at, advance: (ms: number) => { at += ms; } };
}

describe("input on a bot's own desktop", () => {
  it("defaults to the foreground, which the driver needs for typing into Chromium and GTK fields", () => {
    const session = createSandboxComputerSession();
    expect(sent(session.request(call(1, "type_text", { pid: 4, text: "hi" })))).toEqual({ pid: 4, text: "hi", delivery_mode: "foreground" });
    expect(sent(session.request(call(2, "run_steps", { steps: [] })))).toMatchObject({ delivery_mode: "foreground" });
    expect(session.metrics.foregroundDefaults).toBe(2);
  });
  it("keeps a delivery_mode the bot chose, and leaves reads and other frames byte for byte", () => {
    const session = createSandboxComputerSession();
    const lines = [
      call(1, "click", { x: 1, y: 2, delivery_mode: "background" }),
      call(2, "get_window_state", { pid: 4 }),
      call(3, "launch_app", { name: "chromium" }),
      JSON.stringify({ jsonrpc: "2.0", id: 4, method: "tools/list" }),
      "not json \"tools/call\"",
    ];
    for (const line of lines) expect(session.request(line)).toBe(line);
  });
});

describe("a screenshot that did not change", () => {
  it("is left out once, with a note, and shown again when asked again", () => {
    const time = clock();
    const session = createSandboxComputerSession(time.now);
    session.request(call(1, "get_window_state", { pid: 4, window_id: 7 }));
    const first = answer(1, shot("AAAA"));
    expect(session.response(first)).toBe(first);

    time.advance(4_000);
    session.request(call(2, "get_window_state", { pid: 4, window_id: 7 }));
    const second = parts(session.response(answer(2, shot("AAAA"))));
    expect(second.map((part) => part.type)).toEqual(["text", "text"]);
    expect(second[1]!.text).toContain("identical to the one this read returned 4s ago");

    session.request(call(3, "get_window_state", { pid: 4, window_id: 7 }));
    const third = answer(3, shot("AAAA"));
    expect(session.response(third)).toBe(third);
    expect(session.metrics).toMatchObject({ screenshots: 3, screenshotsLeftOut: 1 });
  });
  it("is always sent after a change, for another window, or once the last look is old", () => {
    const time = clock();
    const session = createSandboxComputerSession(time.now);
    const read = (id: number, window: number, data: string) => {
      session.request(call(id, "get_window_state", { pid: 4, window_id: window }));
      const line = answer(id, shot(data));
      return session.response(line) === line;
    };
    expect(read(1, 7, "AAAA")).toBe(true);
    expect(read(2, 7, "BBBB")).toBe(true);
    expect(read(3, 8, "BBBB")).toBe(true);
    time.advance(SAME_FRAME_MS + 1);
    expect(read(4, 7, "BBBB")).toBe(true);
  });
  it("never touches an error, or a read whose answer carries no single image", () => {
    const session = createSandboxComputerSession();
    session.request(call(1, "get_window_state", { pid: 4 }));
    session.response(answer(1, shot("AAAA")));
    session.request(call(2, "get_window_state", { pid: 4 }));
    const error = answer(2, shot("AAAA"), { isError: true });
    expect(session.response(error)).toBe(error);
    session.request(call(3, "get_window_state", { pid: 4, include_screenshot: false }));
    const tree = answer(3, [{ type: "text", text: "tree" }]);
    expect(session.response(tree)).toBe(tree);
  });
});

describe("the same action again and again", () => {
  it(`is called out on the ${REPEAT_LIMIT}rd identical call, even with reads between`, () => {
    const session = createSandboxComputerSession();
    const click = (id: number) => {
      session.request(call(id, "click", { pid: 4, x: 10, y: 20 }));
      return parts(session.response(answer(id, [{ type: "text", text: "Clicked" }])));
    };
    expect(click(1)).toHaveLength(1);
    session.request(call(2, "get_window_state", { pid: 4 }));
    session.response(answer(2, [{ type: "text", text: "tree" }]));
    expect(click(3)).toHaveLength(1);
    const third = click(4);
    expect(third).toHaveLength(2);
    expect(third[1]!.text).toContain("same click with the same arguments 3 times in a row");
    expect(session.metrics.repeatWarnings).toBe(1);
  });
  it("starts over after any other action, and never counts keys or scrolling", () => {
    const session = createSandboxComputerSession();
    const run = (id: number, name: string, args: Record<string, unknown>) => {
      session.request(call(id, name, args));
      return parts(session.response(answer(id, [{ type: "text", text: "ok" }]))).length;
    };
    run(1, "click", { x: 1, y: 1 });
    run(2, "click", { x: 1, y: 1 });
    run(3, "press_key", { key: "escape" });
    expect(run(4, "click", { x: 1, y: 1 })).toBe(1);
    for (let id = 5; id < 10; id++) expect(run(id, "press_key", { key: "tab" })).toBe(1);
  });
});

// cua-driver 0.47.24 on X11, a shortcut that opens Thunar's Create New Folder dialog in the foreground
const KEPT = "the input was sent, but the prior focus could not be restored: not_restored (focus 0x1600008->0x1600058, active 0x1600007->0x1600057)";
const keptBatch = (index: number, total: number) => ({
  content: [{ type: "text", text: `run_steps: step ${index + 1} of ${total} failed\n${index + 1}. hotkey ERROR (action): ${KEPT}` }],
  isError: true,
  structuredContent: { code: "tool_invocation_failed", executed: index + 1, failed_step: index, ok: false, total,
    steps: [{ index, message: KEPT, ok: false, phase: "action", tool: "hotkey" }] },
});

describe("a dialog the bot's own input opened", () => {
  it("answers a direct input as done, since the driver sent it", () => {
    const session = createSandboxComputerSession();
    session.request(call(1, "hotkey", { pid: 4, keys: ["ctrl", "shift", "n"] }));
    const line = JSON.parse(session.response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: KEPT }], isError: true, structuredContent: { code: "tool_invocation_failed" } } })));
    expect(line.result.isError).toBe(false);
    expect(line.result.structuredContent).toBeUndefined();
    expect(line.result.content[0].text).toContain("took the focus");
    expect(session.metrics.dialogsOpened).toBe(1);
  });
  it("leaves other failures and reads alone", () => {
    const session = createSandboxComputerSession();
    session.request(call(1, "hotkey", { pid: 4, keys: ["ctrl", "q"] }));
    const failed = JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "Background delivery is not available" }], isError: true } });
    expect(session.response(failed)).toBe(failed);
    expect(session.relay({ name: "click", arguments: {} }, { call: async () => ({}), driverVersion: undefined })).toBeNull();
  });
  it("runs the rest of a batch from the step whose dialog took the focus, its checks first", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const steps = [{ hotkey: { keys: ["ctrl", "shift", "n"] }, expect: [{ app: "Thunar", window: "Create New Folder" , name: "Create" }] },
      { type_text: { text: "invoices" } }, { press_key: { key: "return" } }];
    const result = await runStepsThroughDialogs({ pid: 4, delivery_mode: "foreground", steps }, {
      call: async (_name, args) => {
        calls.push(args);
        return calls.length === 1 ? keptBatch(0, 3) : { content: [{ type: "text", text: "run_steps: 3/3 steps ok" }] };
      },
    });
    expect(calls[1]).toEqual({ pid: 4, delivery_mode: "foreground", steps: [{ expect: steps[0]!.expect }, steps[1], steps[2]] });
    expect(result.isError).toBeUndefined();
    const text = (result.content as Array<{ text: string }>).map((part) => part.text).join("\n");
    expect(text).toContain("Step 1 sent its input");
    expect(text).toContain("numbered from step 1 of your batch");
    expect(text).toContain("3/3 steps ok");
  });
  it("answers done when the stopped step was the last, and passes any other answer through unchanged", async () => {
    const steps = [{ type_text: { text: "x" } }, { hotkey: { keys: ["ctrl", "o"] } }];
    const done = await runStepsThroughDialogs({ steps }, { call: async () => keptBatch(1, 2) });
    expect(done.isError).toBeUndefined();
    expect((done.content as Array<{ text: string }>)[0]!.text).toContain("all 2 steps ran");
    const other = { content: [{ type: "text", text: "run_steps: step 1 of 1 failed" }], isError: true };
    expect(await runStepsThroughDialogs({ steps: [steps[0]] }, { call: async () => other })).toBe(other);
  });
});
