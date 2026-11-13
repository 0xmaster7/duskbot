import { createHash } from "node:crypto";

type JsonObject = Record<string, unknown>;

/** cua-driver 0.37.0 refuses background input to Chromium and GTK text fields on X11 ("Background delivery is not
 * available"), so a call without delivery_mode costs the bot a failed round trip. The pointer here is the bot's own. */
const FOREGROUND_TOOLS: ReadonlySet<string> = new Set([
  "click", "double_click", "right_click", "drag", "type_text", "press_key", "hotkey", "scroll", "set_value", "run_steps",
]);
const READ_TOOLS: ReadonlySet<string> = new Set(["get_window_state", "get_desktop_state", "zoom"]);
/** Actions whose verbatim repeat is a sign of being stuck; keys and scrolling repeat on purpose. */
const REPEAT_TOOLS: ReadonlySet<string> = new Set(["click", "double_click", "right_click", "drag", "type_text", "set_value", "run_steps"]);

export const REPEAT_LIMIT = 3;
export const SAME_FRAME_MS = 30_000;
const TRACKED_CALLS = 64;

export interface SandboxSessionMetrics {
  actions: number;
  screenshots: number;
  screenshotsLeftOut: number;
  foregroundDefaults: number;
  repeatWarnings: number;
}

interface Pending { name: string; view: string | null; repeat: number }
interface Seen { hash: string; at: number; leftOut: boolean }

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parse(line: string): JsonObject | null {
  try {
    const frame: unknown = JSON.parse(line);
    return isObject(frame) ? frame : null;
  } catch {
    return null;
  }
}

/** The view a read shows: the tool and window, and a zoom's region, so a screenshot is compared only with its own kind. */
function viewOf(name: string, args: JsonObject): string {
  const window = args.window_id ?? args.pid ?? "front";
  const region = name === "zoom" ? [args.x1, args.y1, args.x2, args.y2].join(",") : "";
  const size = args.max_image_dimension ?? args.max_dimension ?? "";
  return `${name}:${String(window)}:${region}:${String(size)}`;
}

function signatureOf(name: string, args: JsonObject): string {
  const { session: _session, delivery_mode: _delivery, ...rest } = args;
  return `${name}:${JSON.stringify(rest)}`;
}

const seconds = (ms: number) => Math.max(1, Math.round(ms / 1000));

export function sameFrameNote(ms: number): string {
  return `The screenshot is identical to the one this read returned ${seconds(ms)}s ago, so it is left out: nothing on this view changed since then. Read again if you need the image anyway.`;
}

export function repeatNote(name: string, times: number): string {
  return `This is the same ${name} with the same arguments ${times} times in a row. If the window did not change, it is not working: read the window again, target the element by role and name or use a keyboard route, or say what blocks you. Do not send it again unchanged.`;
}

export function createSandboxComputerSession(now: () => number = Date.now) {
  const pending = new Map<string, Pending>();
  const frames = new Map<string, Seen>();
  let lastAction: string | null = null;
  let repeats = 0;
  const metrics: SandboxSessionMetrics = { actions: 0, screenshots: 0, screenshotsLeftOut: 0, foregroundDefaults: 0, repeatWarnings: 0 };

  const track = (id: unknown, entry: Pending) => {
    if (typeof id !== "string" && typeof id !== "number") return;
    pending.set(JSON.stringify(id), entry);
    if (pending.size > TRACKED_CALLS) pending.delete(pending.keys().next().value!);
  };

  /** One agent → driver frame; only a tools/call of a known tool is parsed, and only delivery_mode is ever added. */
  function request(line: string): string {
    if (!line.includes("\"tools/call\"")) return line;
    const frame = parse(line);
    const params = frame && frame.method === "tools/call" && isObject(frame.params) ? frame.params : null;
    if (!frame || !params || typeof params.name !== "string") return line;
    const name = params.name;
    const args = isObject(params.arguments) ? params.arguments : {};
    let repeat = 0;
    if (REPEAT_TOOLS.has(name)) {
      metrics.actions += 1;
      const signature = signatureOf(name, args);
      repeats = signature === lastAction ? repeats + 1 : 1;
      lastAction = signature;
      repeat = repeats;
    } else if (!READ_TOOLS.has(name) && FOREGROUND_TOOLS.has(name)) {
      metrics.actions += 1;
      lastAction = null;
    }
    if (READ_TOOLS.has(name) || repeat >= REPEAT_LIMIT) {
      track(frame.id, { name, view: READ_TOOLS.has(name) ? viewOf(name, args) : null, repeat });
    }
    if (!FOREGROUND_TOOLS.has(name) || args.delivery_mode !== undefined) return line;
    metrics.foregroundDefaults += 1;
    return JSON.stringify({ ...frame, params: { ...params, arguments: { ...args, delivery_mode: "foreground" } } });
  }

  function leaveOutRepeatedFrame(view: string, content: unknown[]): unknown[] | null {
    const images = content.filter((part) => isObject(part) && part.type === "image" && typeof part.data === "string") as JsonObject[];
    if (images.length !== 1) return null;
    metrics.screenshots += 1;
    const hash = createHash("sha256").update(String(images[0]!.data)).digest("hex");
    const before = frames.get(view);
    const at = now();
    // left out at most once in a row: asking again always shows the image
    const leaveOut = Boolean(before && before.hash === hash && !before.leftOut && at - before.at <= SAME_FRAME_MS);
    frames.set(view, { hash, at: leaveOut ? before!.at : at, leftOut: leaveOut });
    if (!leaveOut) return null;
    metrics.screenshotsLeftOut += 1;
    return content.map((part) => (part === images[0] ? { type: "text", text: sameFrameNote(at - before!.at) } : part));
  }

  /** One driver → agent frame, after the shared rewrites. */
  function response(line: string): string {
    if (!pending.size || !line.includes("\"result\"")) return line;
    const frame = parse(line);
    if (!frame || frame.id === undefined) return line;
    const key = JSON.stringify(frame.id);
    const call = pending.get(key);
    if (!call) return line;
    pending.delete(key);
    const result = isObject(frame.result) ? frame.result : null;
    if (!result || !Array.isArray(result.content)) return line;
    let content: unknown[] = result.content;
    if (call.view && !result.isError) content = leaveOutRepeatedFrame(call.view, content) ?? content;
    if (call.repeat >= REPEAT_LIMIT) {
      metrics.repeatWarnings += 1;
      content = [...content, { type: "text", text: repeatNote(call.name, call.repeat) }];
    }
    return content === result.content ? line : JSON.stringify({ ...frame, result: { ...result, content } });
  }

  return { request, response, metrics };
}

export type SandboxComputerSession = ReturnType<typeof createSandboxComputerSession>;
