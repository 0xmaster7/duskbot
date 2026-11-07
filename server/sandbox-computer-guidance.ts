// cua-driver 0.37.0 on the VPS bot desktop runs in standard mode without --grant existing-profile, so its typed browser
// tools (get_browser_state, browser_prepare, browser_*, page) refuse every Chromium window with browser_consent_required,
// and its MCP instructions still send the model there and forbid pointer input. On a sandboxed desktop the pointer is the
// bot's own, so the listing drops what cannot work and the instructions say what does.
import { listsComputerTool } from "./computer-tool-list.ts";
import { PLAIN_WORDS } from "./local-computer-guidance.ts";

type JsonObject = Record<string, unknown>;

/** What the driver's MCP instructions say on a bot's own sandboxed desktop. */
export const SANDBOX_DRIVER_INSTRUCTIONS = [
  "cua-driver on your own sandboxed Linux desktop (X11; get_screen_size gives its size). It is not the person's own screen, so foreground input is fine here.",
  "1. Find windows with list_windows({app:\"Chromium\"}) for pid and window_id. To open a page: launch_app({name:\"chromium\", urls:[\"https://...\"]}). Chromium can take 10 to 20 seconds to show its first window: call list_windows again instead of launching it twice.",
  "2. Read a window with get_window_state. Chromium's web content is mostly missing from the accessibility tree here: read the page from the screenshot (zoom for small text) and act with x,y from that window's own screenshot, delivery_mode \"foreground\". Dialogs such as Save File are in the tree; act on them by element_token.",
  "3. Act through run_steps({steps:[{tool,args}],observe:{include_screenshot:true}}): it stops at the first failure and shows the result. In Chromium go to an address with hotkey ctrl+l, type_text, press_key enter.",
  "4. There are no typed browser tools on this desktop; do not look for get_browser_state or browser_prepare.",
  "5. Command-line work (curl downloads, checking a file's size, parsing a page, writing a CSV, installing software) goes through vm_exec, never typed into a terminal window.",
  "6. Verify at checkpoints with a screenshot. If the same step fails twice, change approach or report what blocks you; do not repeat it a third time.",
].join("\n");

const SANDBOX_BROWSER_REFUSED =
  "This desktop's Chromium cannot take the typed browser tools, and nothing the person can turn on changes that: do not call browser_prepare again or ask anyone to authorize it. " +
  "Drive this window with get_window_state screenshots and click, type_text, press_key and scroll at x,y with delivery_mode \"foreground\"; this pointer is your own. " +
  "For a page's text or data, vm_exec with curl or python3 is faster. " + PLAIN_WORDS;

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function rewriteResult(result: JsonObject): JsonObject | null {
  if (Array.isArray(result.tools)) {
    const tools = result.tools.filter((tool) => !isObject(tool) || typeof tool.name !== "string" || listsComputerTool(tool.name, true));
    return tools.length === result.tools.length ? null : { ...result, tools };
  }
  if (typeof result.instructions === "string" && isObject(result.serverInfo)) return { ...result, instructions: SANDBOX_DRIVER_INSTRUCTIONS };
  const refusal = isObject(result.structuredContent) && isObject(result.structuredContent.refusal) ? result.structuredContent.refusal : null;
  if (refusal?.code === "browser_consent_required" && Array.isArray(result.content)) {
    const { structuredContent: _dropped, ...rest } = result;
    return { ...rest, isError: true, content: [{ type: "text", text: SANDBOX_BROWSER_REFUSED }] };
  }
  return null;
}

/** One MCP stdio frame from a sandboxed desktop's driver: its tool list, its instructions and a browser refusal change. */
export function sandboxComputerResultLine(line: string): string {
  if (!line.includes("\"tools\"") && !line.includes("\"instructions\"") && !line.includes("browser_consent_required")) return line;
  let frame: unknown;
  try {
    frame = JSON.parse(line);
  } catch {
    return line;
  }
  if (!isObject(frame) || !isObject(frame.result)) return line;
  const result = rewriteResult(frame.result);
  return result ? JSON.stringify({ ...frame, result }) : line;
}
