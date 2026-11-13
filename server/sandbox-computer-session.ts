import { createHash } from "node:crypto";
import type { ChildCalls, ToolCall } from "./mcp-bridge.ts";

type JsonObject = Record<string, unknown>;

/** cua-driver refuses background input to Chromium and GTK text fields on X11 ("Background delivery is not available"),
 * and 0.47 opens GTK menus (invoke_menu) only in the foreground, so a call without delivery_mode costs the bot a failed
 * round trip. The pointer here is the bot's own. */
const FOREGROUND_TOOLS: ReadonlySet<string> = new Set([
  "click", "double_click", "right_click", "drag", "type_text", "press_key", "hotkey", "scroll", "set_value", "run_steps",
  "invoke_menu",
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
  /** foreground inputs the driver called failed because a dialog they opened kept the focus */
  dialogsOpened: number;
}

interface Pending { name: string; view: string | null; repeat: number; focusKept: boolean }
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

/** cua-driver 0.47 gives the focus back after every foreground action on X11, and reports a new window of the target app
 * that took it (the dialog a shortcut or click opened) as a failure, although its input was delivered. On the bot's own
 * desktop that dialog is what the bot wanted. */
const FOCUS_KEPT = /^the input was sent, but the prior focus could not be restored\b/;
const FOCUS_KEPT_NOTE = "Done: the input was sent and a new window of this app took the focus (likely a dialog it opened). Read or target that window next.";
/** a batch that keeps opening dialogs goes on at most this many times */
const MAX_CONTINUATIONS = 8;

function textOf(result: JsonObject): string {
  return Array.isArray(result.content) ? result.content.filter((part) => isObject(part) && part.type === "text").map((part) => String((part as JsonObject).text ?? "")).join("\n") : "";
}

/** The step a run_steps answer stopped at because a dialog took the focus after its input was sent, else null. */
function focusKeptStep(result: JsonObject): number | null {
  const sc = isObject(result.structuredContent) ? result.structuredContent : null;
  if (result.isError !== true || !sc || typeof sc.failed_step !== "number" || !Array.isArray(sc.steps)) return null;
  const failed = sc.steps.find((step) => isObject(step) && step.index === sc.failed_step);
  return isObject(failed) && failed.phase === "action" && typeof failed.message === "string" && FOCUS_KEPT.test(failed.message) ? sc.failed_step : null;
}

/**
 * run_steps on a sandboxed desktop: a step whose input opened a dialog stops the driver's batch (see FOCUS_KEPT), so the
 * bridge runs the rest of the batch from there, the stopped step's own checks first, and answers once for the whole.
 */
export async function runStepsThroughDialogs(args: JsonObject, child: Pick<ChildCalls, "call">): Promise<JsonObject> {
  let steps = Array.isArray(args.steps) ? args.steps : [];
  let offset = 0;
  const notes: string[] = [];
  let result = await child.call("run_steps", args);
  for (let round = 0; round < MAX_CONTINUATIONS; round++) {
    const at = focusKeptStep(result);
    if (at === null || at < 0 || at >= steps.length) break;
    const stopped = steps[at];
    const checks = isObject(stopped) && Array.isArray(stopped.expect) && stopped.expect.length ? [{ expect: stopped.expect }] : [];
    const rest = [...checks, ...steps.slice(at + 1)];
    notes.push(`Step ${offset + at + 1} sent its input and a new window of the app took the focus (likely a dialog it opened), so the batch went on from there.`);
    if (!rest.length) return { content: [{ type: "text", text: `run_steps: all ${offset + steps.length} steps ran\n${notes.join("\n")}` }] };
    offset += at + 1 - checks.length;
    steps = rest;
    result = await child.call("run_steps", { ...args, steps: rest });
  }
  if (!notes.length) return result;
  const head = `${notes.join("\n")}\n(the steps below are numbered from step ${offset + 1} of your batch)`;
  const content = [{ type: "text", text: head }, ...(Array.isArray(result.content) ? result.content : [])];
  return { ...result, content };
}

export function createSandboxComputerSession(now: () => number = Date.now) {
  const pending = new Map<string, Pending>();
  const frames = new Map<string, Seen>();
  let lastAction: string | null = null;
  let repeats = 0;
  const metrics: SandboxSessionMetrics = { actions: 0, screenshots: 0, screenshotsLeftOut: 0, foregroundDefaults: 0, repeatWarnings: 0, dialogsOpened: 0 };

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
    // a direct input whose dialog kept the focus is answered as done (run_steps goes through relay instead)
    const focusKept = FOREGROUND_TOOLS.has(name) && name !== "run_steps";
    if (READ_TOOLS.has(name) || repeat >= REPEAT_LIMIT || focusKept) {
      track(frame.id, { name, view: READ_TOOLS.has(name) ? viewOf(name, args) : null, repeat, focusKept });
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
    let result = isObject(frame.result) ? frame.result : null;
    if (!result || !Array.isArray(result.content)) return line;
    if (call.focusKept && result.isError === true && FOCUS_KEPT.test(textOf(result))) {
      metrics.dialogsOpened += 1;
      const { structuredContent: _failed, ...rest } = result;
      result = { ...rest, isError: false, content: [{ type: "text", text: FOCUS_KEPT_NOTE }] };
    }
    let content: unknown[] = result.content as unknown[];
    if (call.view && !result.isError) content = leaveOutRepeatedFrame(call.view, content) ?? content;
    if (call.repeat >= REPEAT_LIMIT) {
      metrics.repeatWarnings += 1;
      content = [...content, { type: "text", text: repeatNote(call.name, call.repeat) }];
    }
    return content === result.content && result === frame.result ? line : JSON.stringify({ ...frame, result: { ...result, content } });
  }

  /** The bridge's relay: run_steps goes through runStepsThroughDialogs, everything else to the driver as it came. */
  function relay(call: ToolCall, child: ChildCalls): Promise<unknown> | null {
    if (call.name !== "run_steps") return null;
    return runStepsThroughDialogs(call.arguments, {
      call: async (name, args) => {
        const result = await child.call(name, args);
        if (focusKeptStep(result) !== null) metrics.dialogsOpened += 1;
        return result;
      },
    });
  }

  return { request, response, relay, metrics };
}

export type SandboxComputerSession = ReturnType<typeof createSandboxComputerSession>;
