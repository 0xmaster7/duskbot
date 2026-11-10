import { describe, expect, it } from "vitest";

import { codexDynamicToolReply, codexStatusThreadParams } from "./codex-status-tool.ts";

describe("codex set_status dynamic tool", () => {
  it("is loaded up front on a Codex that takes dynamic tools, and left out on an older or unknown one", () => {
    expect(codexStatusThreadParams("0.167.0").dynamicTools).toEqual([
      expect.objectContaining({ type: "function", name: "set_status", deferLoading: false, inputSchema: expect.objectContaining({ required: ["status"] }) }),
    ]);
    expect(codexStatusThreadParams("0.170.2").dynamicTools).toHaveLength(1);
    expect(codexStatusThreadParams("0.166.9")).toEqual({});
    expect(codexStatusThreadParams(null)).toEqual({});
  });

  it("answers set_status and refuses any other dynamic tool", () => {
    expect(codexDynamicToolReply({ tool: "set_status", namespace: null, arguments: { status: "x" } } as never))
      .toEqual({ result: { contentItems: [{ type: "inputText", text: "ok" }], success: true } });
    expect(codexDynamicToolReply({ tool: "run_anything" })).toMatchObject({ error: { code: -32601 } });
    expect(codexDynamicToolReply({ tool: "set_status", namespace: "other" })).toMatchObject({ error: { code: -32601 } });
  });
});
