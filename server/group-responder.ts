import type { GroupDefaultResponder } from "../shared/wire.ts";

/** A stored or patched room responder, made valid for the room's members. */
export function normalizeGroupDefaultResponder(
  value: unknown,
  memberIds: string[],
  dm = false,
): GroupDefaultResponder {
  if (dm) return { kind: "mentions" };
  if (value && typeof value === "object") {
    const candidate = value as { kind?: unknown; botId?: unknown; fallbackBotId?: unknown; leader?: unknown; by?: unknown };
    if (candidate.kind === "everyone") return { kind: "everyone" };
    if (candidate.kind === "mentions") return { kind: "mentions" };
    if (candidate.kind === "auto") {
      const by = candidate.by === "dusk" ? { by: "dusk" as const } : {};
      return typeof candidate.fallbackBotId === "string" && memberIds.includes(candidate.fallbackBotId)
        ? { kind: "auto", fallbackBotId: candidate.fallbackBotId, ...by }
        : { kind: "auto", ...by };
    }
    if (
      candidate.kind === "member" &&
      typeof candidate.botId === "string" &&
      memberIds.includes(candidate.botId)
    ) {
      return { kind: "member", botId: candidate.botId, ...(candidate.leader === true ? { leader: true as const } : {}) };
    }
    // a leader who left hands the room to the first member still in it, so the room keeps a leader
    if (candidate.kind === "member" && candidate.leader === true && memberIds[0]) {
      return { kind: "member", botId: memberIds[0], leader: true };
    }
  }
  if (memberIds.length === 0) return { kind: "mentions" };
  return { kind: "everyone" };
}
