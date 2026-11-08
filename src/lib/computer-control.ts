import type { ComputerHelpRef } from "../../shared/wire";
import { productName } from "@/lib/brand";

export type ComputerControlAction = "take" | "release";

export interface ComputerControlSnapshot {
  held: boolean;
  helpReason: string | null;
  help?: ComputerHelpRef | null;
}

const HELP_PLACES = new Set(["browser", "local", "vm", "cloud"]);

export function parseComputerHelp(value: unknown): ComputerHelpRef | null {
  const ref = value as Partial<Record<keyof ComputerHelpRef, unknown>> | null;
  if (!ref || typeof ref !== "object") return null;
  const { botId, threadId, messageId, site, place } = ref;
  return typeof botId === "string" && typeof threadId === "string" && typeof messageId === "string" &&
    typeof site === "string" && typeof place === "string" && HELP_PLACES.has(place)
    ? { botId, threadId, messageId, site, place: place as ComputerHelpRef["place"] } : null;
}

/** Take is local-first, release server-first; BrowserPanel owns the same choreography itself. */
export async function transitionComputerControlLease<
  Action extends ComputerControlAction,
  Snapshot extends ComputerControlSnapshot,
>(input: {
  action: Action;
  syncNativeBrowser: boolean;
  requestControl: (action: Action) => Promise<Snapshot>;
  setNativeBrowserControl: (held: boolean) => Promise<boolean>;
}): Promise<Snapshot> {
  const { action, syncNativeBrowser, requestControl, setNativeBrowserControl } = input;
  if (action === "take" && syncNativeBrowser && !(await setNativeBrowserControl(true))) {
    throw new Error(`${productName()} could not pause this bot's browser safely`);
  }
  const snap = await requestControl(action);
  if (snap.held !== (action === "take")) {
    throw new Error(`${productName()} could not ${action === "take" ? "confirm" : "release"} computer control`);
  }
  if (action === "release" && syncNativeBrowser && !(await setNativeBrowserControl(false))) {
    throw new Error("The computer was released, but the browser remains paused for safety");
  }
  return snap;
}
