import { randomBytes } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { CommandResult, DashboardCommand } from "../shared/dashboard-protocol.ts";
import type { createDashboardCollector } from "./dashboard-report.ts";
import type { RequestAuth } from "./request-auth.ts";

export function createDashboardCommands(deps: { port: number; collect: ReturnType<typeof createDashboardCollector>; fetch?: typeof fetch }) {
  const pending = new Map<string, { path: string; method: string }>();
  const owners = new WeakSet<RequestAuth>();
  function authenticate(req: IncomingMessage): RequestAuth | null {
    const key = req.headers["x-omb-dashboard-command"];
    const grant = typeof key === "string" ? pending.get(key) : undefined;
    if (!grant || !["127.0.0.1", "::ffff:127.0.0.1", "::1"].includes(req.socket.remoteAddress ?? "") || req.method !== grant.method || req.url !== grant.path) return null;
    pending.delete(key as string);
    // only this process can mint a one-use owner grant for the exact command route.
    const auth: RequestAuth = { kind: "loopback", scopes: ["admin", "client"] };
    owners.add(auth);
    return auth;
  }
  async function execute(command: DashboardCommand): Promise<CommandResult> {
    const result = (ok: boolean, message: string): CommandResult => ({ id: command.id, ok, message, at: Date.now() });
    let path: string, method: string, message: string, body: object = {};
    const target = encodeURIComponent(command.target);
    if (command.kind === "computer.wake" || command.kind === "computer.sleep") {
      const bot = deps.collect.bots().find((bot) => bot.id === command.target);
      if (!bot || !bot.computer) return result(false, "This bot's computer could not be found.");
      const wake = command.kind === "computer.wake";
      path = `/api/bots/${target}/${bot.computer === "local-vm" ? `local-computer/${wake ? "start" : "stop"}` : `computer/${wake ? "provision" : "sleep"}`}`;
      method = "POST"; message = `${bot.name}'s computer is ${wake ? "waking up" : "asleep"}.`;
    } else if (command.kind === "phone.revoke") {
      const phone = (await deps.collect.devices()).phones.find((phone) => phone.id === command.target);
      if (!phone) return result(false, "This phone could not be found.");
      if (command.target.startsWith("phone:")) path = `/api/phones/${encodeURIComponent(command.target.slice(6))}`;
      else if (command.target.startsWith("mobile:")) path = `/api/mobile/devices/${encodeURIComponent(command.target.slice(7))}`;
      else return result(false, "This phone's registration could not be found.");
      method = "DELETE"; message = `Revoked ${phone.label}.`;
    } else if (command.kind === "session.revoke") {
      const session = (await deps.collect.devices()).sessions.find((session) => session.id === command.target);
      if (!session) return result(false, "This session could not be found.");
      path = `/api/auth/sessions/${target}`; method = "DELETE"; message = `Revoked ${session.label}.`;
    } else if (command.kind === "routine.pause" || command.kind === "routine.resume") {
      const routine = deps.collect.bots().flatMap((bot) => bot.routines).find((routine) => routine.id === command.target);
      if (!routine) return result(false, "This routine could not be found.");
      const enabled = command.kind === "routine.resume";
      path = `/api/routines/${target}`; method = "PATCH"; body = { enabled }; message = `${enabled ? "Resumed" : "Paused"} ${routine.name}.`;
    } else return result(false, "This dashboard command is not supported.");
    const nonce = randomBytes(32).toString("base64url");
    pending.set(nonce, { path, method });
    try {
      const response = await (deps.fetch ?? fetch)(`http://127.0.0.1:${deps.port}${path}`, { method, redirect: "error", signal: AbortSignal.timeout(55_000),
        headers: { "content-type": "application/json", "x-omb-dashboard-command": nonce }, ...(method === "DELETE" ? {} : { body: JSON.stringify(body) }) });
      if (!response.ok) {
        const answer = await response.json().catch(() => ({})) as { error?: unknown };
        return result(false, typeof answer.error === "string" ? answer.error : "The workspace could not complete this action.");
      }
      return result(true, message);
    } catch { return result(false, "The workspace could not complete this action."); }
    finally { pending.delete(nonce); }
  }
  return { execute, authenticate, owns: (auth: RequestAuth) => owners.has(auth) };
}
