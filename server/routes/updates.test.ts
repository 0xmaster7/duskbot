import type { ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import type { RequestAuth } from "../request-auth.ts";
import { createUpdateRoutes, UPDATE_BUSY_PATH } from "./updates.ts";
import type { RouteContext } from "./table.ts";

async function ask(auth: RequestAuth, busy: string[], method = "GET") {
  let answer: { status: number; body: unknown } | null = null;
  const res = { setHeader() {} } as unknown as ServerResponse;
  const json = ((_res: ServerResponse, status: number, body: unknown) => { answer = { status, body }; }) as RouteContext["json"];
  await createUpdateRoutes(() => null, () => busy)({ req: {} as never, res, url: new URL(`http://127.0.0.1${UPDATE_BUSY_PATH}`), path: UPDATE_BUSY_PATH, method, auth, json, readBody: (async () => null) as never });
  return answer!;
}

describe("the update busy read", () => {
  it("tells the owner's loopback (root's updater) what holds an update back", async () => {
    expect(await ask({ kind: "loopback", scopes: ["admin", "client"] }, ["turn"])).toEqual({ status: 200, body: { busy: ["turn"] } });
    expect(await ask({ kind: "loopback", scopes: ["admin", "client"] }, [])).toEqual({ status: 200, body: { busy: [] } });
  });

  it("is refused to a shared server's bot shells, a companion device and any session", async () => {
    expect((await ask({ kind: "loopback", scopes: ["client"], trust: "service" }, [])).status).toBe(403);
    expect((await ask({ kind: "loopback", scopes: ["client"], companionDevice: "d1" }, [])).status).toBe(403);
    expect((await ask({ kind: "session", scopes: ["admin", "client"] } as unknown as RequestAuth, [])).status).toBe(403);
    expect((await ask({ kind: "loopback", scopes: ["admin", "client"] }, [], "POST")).status).toBe(405);
  });
});
