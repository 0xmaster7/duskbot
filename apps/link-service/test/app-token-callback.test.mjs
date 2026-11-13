import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createLinkService } from "../src/app.mjs";

const STATE = `18799.${"ab".repeat(16)}`;
const outbound = vi.fn(() => { throw new Error("unexpected outbound request"); });
let dir, service, server, base;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "omb-app-token-callback-"));
  service = createLinkService({ base: "http://link.test", dataDir: dir, scriptPath: "fixture/install.sh", agentPath: "fixture/agent.mjs", trustProxy: false, log: vi.fn(), fetch: outbound });
  server = createServer((req, res) => void service.handler(req, res));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  service.close();
  await new Promise((resolve) => server.close(resolve));
  rmSync(dir, { recursive: true, force: true });
});

const callback = (query) => fetch(`${base}/oauth/app-tokens?${query}`, { redirect: "manual" });

describe("native OAuth callback", () => {
  it("sends the browser back to the port the state names, with only the sign-in's own fields", async () => {
    const response = await callback(new URLSearchParams({ code: "c0de.x-1", state: STATE, extra: "<script>" }));
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(`http://127.0.0.1:18799/api/app-tokens/callback?state=${STATE}&code=c0de.x-1`);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(outbound).not.toHaveBeenCalled();
  });

  it("passes a refusal on, and Trello's state-only return (its token stays in the fragment)", async () => {
    const denied = await callback(new URLSearchParams({ error: "access_denied", error_description: "user said no", state: STATE }));
    expect(denied.headers.get("location")).toBe(`http://127.0.0.1:18799/api/app-tokens/callback?state=${STATE}&error=access_denied&error_description=user+said+no`);
    const trello = await callback(new URLSearchParams({ state: `8799.${"cd".repeat(16)}` }));
    expect(trello.headers.get("location")).toBe(`http://127.0.0.1:8799/api/app-tokens/callback?state=8799.${"cd".repeat(16)}`);
  });

  it("refuses any other port, a bad state or a repeated field, with a page and no redirect", async () => {
    for (const query of [
      new URLSearchParams({ code: "c", state: `22.${"ab".repeat(16)}` }),
      new URLSearchParams({ code: "c", state: `3000.${"ab".repeat(16)}` }),
      new URLSearchParams({ code: "c", state: "ab".repeat(16) }),
      new URLSearchParams([["code", "a"], ["code", "b"], ["state", STATE]]),
      new URLSearchParams([["state", STATE], ["state", STATE]]),
      new URLSearchParams({ code: "é", state: STATE }),
    ]) {
      const response = await callback(query);
      expect(response.status, String(query)).toBe(400);
      expect(response.headers.get("location")).toBeNull();
      expect(await response.text()).toContain("that link didn&#39;t work");
    }
  });
});
