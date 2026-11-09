import { describe, expect, it, vi } from "vitest";
import { callTool, type ToolCallContext } from "./agents-call.ts";
import { availableTools, catalogProfileFromEnv } from "./agents-catalog.ts";
import { WEB_SEARCH_NOT_CONFIGURED } from "../web-search-many.ts";

describe("web_search_many on the agents server", () => {
  it("is listed only with the research credential and availability switches", () => {
    for (const x of ["0", "1"]) for (const research of ["0", "1"]) {
      const listed = availableTools(catalogProfileFromEnv({ DUSK_X_RESEARCH: x, DUSK_RESEARCH: research }));
      expect(listed.some((tool) => tool.name === "web_search_many")).toBe(x === "1" && research === "1");
      if (x === "1" && research === "1") expect(listed.find((tool) => tool.name === "web_search_many")).toMatchObject({ annotations: { readOnlyHint: true, openWorldHint: true } });
    }
  });

  it("routes a batch to the harness and renders unconfigured search as one non-error line", async () => {
    const apiResponse = vi.fn(async () => ({ ok: true, status: 200, body: { message: WEB_SEARCH_NOT_CONFIGURED } }));
    const context: ToolCallContext = { botId: "bot", threadId: "thread", depth: 0, externalRuntime: false, client: { api: vi.fn(), apiResponse } };
    expect(await callTool("web_search_many", { queries: ["one", "two"] }, context)).toEqual({ text: WEB_SEARCH_NOT_CONFIGURED });
    expect(apiResponse).toHaveBeenCalledWith("/api/internal/research/web-search-many", { method: "POST", body: JSON.stringify({ queries: ["one", "two"] }) });
    apiResponse.mockClear();
    expect(await callTool("web_search_many", { queries: Array(11).fill("query") }, context)).toMatchObject({ isError: true });
    expect(apiResponse).not.toHaveBeenCalled();
  });
});
