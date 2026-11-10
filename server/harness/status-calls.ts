// The bot's own words for its status line, from its set_status tool, however an engine spells or bridges the call. The
// call itself is never a step: the bus logs it but delivers only the label it sets.
import { STATUS_LABEL_MAX, STATUS_TOOL } from "../../shared/turn-progress.ts";
import { SERVER_PREFIXES, USE_TOOL } from "../drivers/agents-bridge.ts";
import { newId, type RuntimeEvent } from "../contracts.ts";
import { redactSecretsInText } from "../redact.ts";
import type { ProgressEvent } from "./progress-gate.ts";

type Args = Record<string, unknown>;

function record(value: unknown): value is Args {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function bareName(title: string | undefined): string {
  const name = (title ?? "").trim().replace(/^mcp__.+?__/, "");
  const prefix = SERVER_PREFIXES.find((spelling) => spelling && name.startsWith(spelling));
  return prefix ? name.slice(prefix.length) : name;
}

/** A tool name, in any engine's spelling, that is the set_status tool itself. */
export function isStatusToolName(title: string | undefined): boolean {
  return bareName(title) === STATUS_TOOL;
}

function parsed(input: unknown): unknown {
  if (typeof input !== "string") return input;
  try {
    return JSON.parse(input);
  } catch {
    return undefined;
  }
}

// A driver's preview may be cut short, so the fields are also read from the text as far as it goes.
const NAME_FIELD = /"name"\s*:\s*"set_status"/;
const STATUS_FIELD = /"status"\s*:\s*"((?:[^"\\]|\\.)*)/;

function statusField(args: unknown, input: unknown): string | undefined {
  if (record(args)) return typeof args.status === "string" ? args.status : undefined;
  const match = typeof input === "string" ? STATUS_FIELD.exec(input) : null;
  if (!match) return undefined;
  try {
    return JSON.parse(`"${match[1].replace(/\\$/, "")}"`);
  } catch {
    return match[1];
  }
}

/** A tool call's status text when the call is set_status (directly, or through the bridge's use_tool); `null` for any
 * other call. The text is undefined when the call names no readable status. */
export function statusCallText(title: string | undefined, input: unknown): string | undefined | null {
  const name = bareName(title);
  const args = parsed(input);
  if (name === STATUS_TOOL) return statusField(args, input);
  if (name !== USE_TOOL) return null;
  if (record(args)) return args.name === STATUS_TOOL ? statusField(record(args.arguments) ? args.arguments : {}, undefined) : null;
  return typeof input === "string" && NAME_FIELD.test(input) ? statusField(undefined, input) : null;
}

const TRAILING = /[\s.,;:!?…]+$/u;

/** The status line's label for what the bot said: no leading "is ", sentence case, no trailing punctuation or ellipsis,
 * redacted, and at most STATUS_LABEL_MAX characters, cut at a word. */
export function statusLabel(text: string | undefined): string | undefined {
  if (typeof text !== "string") return undefined;
  let label = redactSecretsInText(text.replace(/\p{Cc}/gu, " ").replace(/\s+/g, " ").trim())
    .replace(/^is\s+/i, "").replace(TRAILING, "");
  if (label.length > STATUS_LABEL_MAX) {
    const cut = label.slice(0, STATUS_LABEL_MAX + 1);
    const space = cut.lastIndexOf(" ");
    label = (space > 0 ? cut.slice(0, space) : cut.slice(0, STATUS_LABEL_MAX)).replace(TRAILING, "");
  }
  return label ? label.charAt(0).toUpperCase() + label.slice(1) : undefined;
}

/** Each thread's label for its running turn, and its set_status calls, which no listener sees as a tool call. */
export class TurnStatus {
  private readonly labels = new Map<string, { turnId?: string; label: string }>();
  private readonly calls = new Map<string, Set<string>>();

  /** True for a set_status call's start, update or end: the bus logs it and delivers nothing. A start that names a
   * status also sets the turn's label and gives the frame that shows it. */
  take(event: RuntimeEvent): { frame?: ProgressEvent } | null {
    if (event.type === "item.started" && event.itemType === "tool") {
      const text = statusCallText(event.title, event.input);
      if (text === null) return null;
      if (event.itemId) {
        let calls = this.calls.get(event.threadId);
        if (!calls) this.calls.set(event.threadId, (calls = new Set()));
        calls.add(event.itemId);
      }
      const label = statusLabel(text);
      if (!label) return {};
      this.labels.set(event.threadId, { turnId: event.turnId, label });
      return {
        frame: {
          eventId: newId(), provider: event.provider, providerInstanceId: event.providerInstanceId, threadId: event.threadId,
          createdAt: event.createdAt, turnId: event.turnId, type: "turn.progress", activity: "tool", tool: STATUS_TOOL, label,
        },
      };
    }
    if ((event.type === "item.completed" || event.type === "item.updated") && event.itemType === "tool" && event.itemId) {
      const calls = this.calls.get(event.threadId);
      if (!calls?.has(event.itemId)) return null;
      if (event.type === "item.completed") calls.delete(event.itemId);
      return {};
    }
    return null;
  }

  /** An engine's own report of a set_status call being written: never a step on the status line. */
  hides(event: ProgressEvent): boolean {
    return event.label === undefined && isStatusToolName(event.tool);
  }

  /** A frame of the turn carries the label the bot set last. */
  stamp(event: ProgressEvent): ProgressEvent {
    if (event.label !== undefined) return event;
    const held = this.labels.get(event.threadId);
    if (!held || (held.turnId && event.turnId && held.turnId !== event.turnId)) return event;
    return { ...event, label: held.label };
  }

  forget(threadId: string): void {
    this.labels.delete(threadId);
    this.calls.delete(threadId);
  }
}
