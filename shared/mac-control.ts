/** "Your Mac": a linked VPS's bots reach the owner's Mac through the Mac app's own signed-in link to that server. */

export const MAC_TOOL_NAMES = [
  "mac_exec", "mac_read_file", "mac_write_file", "mac_list", "mac_open", "mac_save_from_cloud", "mac_screenshot",
] as const;
export type MacToolName = (typeof MAC_TOOL_NAMES)[number];

export function isMacToolName(value: unknown): value is MacToolName {
  return typeof value === "string" && (MAC_TOOL_NAMES as readonly string[]).includes(value);
}

/** GET and PUT /api/mac answer this. */
export interface MacControlStatus {
  /** The owner's Mac app has served this server at least once: the switch means something here. */
  available: boolean;
  /** The Settings switch; default true. */
  enabled: boolean;
  /** The Mac app is polling for work right now. */
  online: boolean;
  /** The Mac's own name, as its app reported it. */
  name: string | null;
  lastSeenAt: number | null;
}

/** One job as the Mac app receives it from GET /api/mac/self/jobs. `download` is a one-time path on this server
 * holding the bytes a mac_save_from_cloud job writes. */
export interface MacJob {
  id: string;
  tool: MacToolName;
  arguments: Record<string, unknown>;
  bot: { id: string; name: string };
  expiresAt: number;
  download?: { path: string; name: string; bytes: number };
}

/** What the Mac app posts to /api/mac/self/jobs/:id/result. */
export type MacJobOutcome =
  | { ok: true; result: { text: string; image?: { data: string; mimeType: "image/png" | "image/jpeg" } } }
  | { ok: false; error: string };
