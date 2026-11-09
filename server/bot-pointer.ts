// The bot's pointer on a bot computer. Cua Driver runs there without its own overlay (--no-overlay), which would sit in
// every frame and recording, yet still tracks where each action lands; the bridge reads that on the agent's own
// connection after the action and the app draws the pointer over the live view.
import type { ChildCalls, ToolCall } from "./mcp-bridge.ts";

export type BotPointerPhase = "move" | "click";
export interface BotPointer { x: number; y: number; phase: BotPointerPhase }

/** Actions that place the driver's agent cursor, and whether they press. */
const POINTER_ACTIONS: ReadonlyMap<string, BotPointerPhase> = new Map([
  ["click", "click"], ["double_click", "click"], ["right_click", "click"], ["mouse_button_down", "click"],
  ["mouse_button_up", "move"], ["move_cursor", "move"], ["drag", "move"], ["mouse_drag", "move"], ["scroll", "move"],
  ["type_text", "move"], ["set_value", "move"],
]);
const MAX_COORDINATE = 16_384;
const REPORT_MS = 2_000;

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function coordinate(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= MAX_COORDINATE ? Math.round(value) : null;
}

export function placesPointer(name: string): boolean {
  return POINTER_ACTIONS.has(name);
}

/** Where `get_agent_cursor_state` puts the agent cursor, only while the driver draws none of its own: a desktop still on
 * the overlay keeps it, and two pointers would show. move_cursor moves the desktop's real pointer and leaves the agent
 * cursor where it was, so `real` (`get_cursor_position`) places it then. A refused action pressed nothing. */
export function botPointerFrom(action: string, refused: boolean, state: unknown, real?: unknown): BotPointer | null {
  const phase = POINTER_ACTIONS.get(action);
  const content = isObject(state) ? state.structuredContent : undefined;
  if (!phase || !isObject(content) || content.enabled !== false) return null;
  const at = real === undefined ? content.position : isObject(real) ? real.structuredContent : undefined;
  if (!isObject(at)) return null;
  const x = coordinate(at.x);
  const y = coordinate(at.y);
  return x === null || y === null ? null : { x, y, phase: refused ? "move" : phase };
}

/** A report as the server takes it; null when anything is off. */
export function parseBotPointer(body: unknown): BotPointer | null {
  if (!isObject(body) || (body.phase !== "move" && body.phase !== "click")) return null;
  const x = coordinate(body.x);
  const y = coordinate(body.y);
  return x === null || y === null || x !== body.x || y !== body.y ? null : { x, y, phase: body.phase };
}

/** After each pointer action the bridge asks the driver where its cursor went and posts it to the computer-control URL. */
export function createBotPointerReporter(options: { url: string; token: string; fetchImpl?: typeof fetch }) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const headers = { authorization: `Bearer ${options.token}`, "content-type": "application/json" };
  return {
    wants: placesPointer,
    async done(call: ToolCall, child: ChildCalls, refused: boolean): Promise<void> {
      const state = await child.call("get_agent_cursor_state", {});
      const real = call.name === "move_cursor" ? await child.call("get_cursor_position", {}) : undefined;
      const pointer = botPointerFrom(call.name, refused, state, real);
      if (!pointer) return;
      await fetchImpl(options.url, { method: "POST", headers, body: JSON.stringify(pointer), signal: AbortSignal.timeout(REPORT_MS) })
        .then((res) => res.arrayBuffer()).catch(() => {});
    },
  };
}

/** The computer-control URL's POST: the bridge's report, shown to whoever watches that computer. */
export function answerBotPointer(body: unknown, show: (pointer: BotPointer) => void): [number, Record<string, unknown>] {
  const pointer = parseBotPointer(body);
  if (!pointer) return [400, { error: "invalid pointer" }];
  show(pointer);
  return [200, { ok: true }];
}
