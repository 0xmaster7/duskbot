// connecting an app through composio connect: authorize composio once, then sign in to the app on composio's page.
// composio's sign-in link expires in 10 minutes (its own instruction text), so a wait that long is a timeout.
import { ApiError } from "@/state/api";

export type ViaFailure = "authorize" | "cancelled" | "timeout" | "signedOut" | "offline" | "refused";

export type ViaFlow =
  | { step: "authorizing" }
  /** `note`: notYet once the person came back and it still is not connected; trouble while composio or mausbot cannot be reached */
  | { step: "waiting"; url: string; since: number; note?: "notYet" | "trouble" }
  | { step: "done" }
  | { step: "failed"; why: ViaFailure; message?: string };

export const VIA_DEADLINE_MS = 10 * 60_000;
const DELAYS = [2_000, 3_000, 5_000, 8_000, 13_000, 15_000];

/** Waits between status checks: quick at first, then every 15 s. */
export const viaDelay = (attempt: number) => DELAYS[Math.min(Math.max(attempt, 0), DELAYS.length - 1)]!;

/** A failed status check: signed out of composio (authorize again), refused for good, or trouble worth retrying
 * (network down, mausbot restarting, composio unreachable). */
export function classifyViaError(cause: unknown): { kind: "signedOut" } | { kind: "refused"; message: string } | { kind: "trouble" } {
  if (!(cause instanceof ApiError)) return { kind: "trouble" };
  const code = typeof cause.body?.code === "string" ? cause.body.code : "";
  if (code === "composio_connect_signed_out" || code === "composio_connect_missing") return { kind: "signedOut" };
  if (cause.status >= 500 || cause.status === 408 || cause.status === 429) return { kind: "trouble" };
  return { kind: "refused", message: cause.message };
}

const PENDING = "omb.composioConnect.pending";
type Pending = Record<string, { url: string; since: number }>;

/** Sign-ins still out, kept across a reload or a restart so the wait picks up where it was. */
export function readPendingVia(now = Date.now()): Pending {
  try {
    const raw = JSON.parse(localStorage.getItem(PENDING) ?? "{}") as Pending;
    return Object.fromEntries(Object.entries(raw).filter(([, entry]) => typeof entry?.url === "string" && typeof entry.since === "number" && now - entry.since < VIA_DEADLINE_MS));
  } catch {
    return {};
  }
}

export function keepPendingVia(slug: string, entry: { url: string; since: number } | null): void {
  try {
    const next = { ...readPendingVia() };
    if (entry) next[slug] = entry; else delete next[slug];
    localStorage.setItem(PENDING, JSON.stringify(next));
  } catch { /* private mode */ }
}
