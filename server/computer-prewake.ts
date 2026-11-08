import { toolSurfaceKind } from "../shared/tool-surface.ts";
import type { WireMessage } from "../shared/wire.ts";
import type { ComputerRelay, RelayOwner } from "./vps-computer-relay.ts";

type HistoryRow = Pick<WireMessage, "role" | "kind" | "turnId" | "tool" | "id">;
const lastComputerTurns = new Map<string, boolean>();
const likelyThisTurn = new Map<string, boolean>();

export interface ComputerPrewakeInput {
  botId?: string;
  place: "cloud" | "auto" | "local" | "vm" | "off" | undefined;
  ownComputer: boolean;
  enabled: boolean;
  message: string;
  history: readonly HistoryRow[];
  currentMessageId?: string;
}

export function lastTurnUsedComputer(history: readonly HistoryRow[], currentMessageId?: string): boolean {
  const boundary = currentMessageId ? history.findIndex(row => row.id === currentMessageId) : -1;
  const end = boundary < 0 ? history.length : boundary;
  let turnId: string | undefined;
  for (let index = end - 1; index >= 0; index--) {
    const row = history[index]!;
    if (row.role === "user" && !turnId) return false;
    if (row.role !== "bot") continue;
    if (row.turnId) {
      turnId ??= row.turnId;
      if (row.turnId !== turnId) return false;
    }
    if (row.tool && toolSurfaceKind(row.tool.name) === "computer") return true;
  }
  return false;
}

export function rememberComputerTurn(botId: string, history: readonly HistoryRow[], turnId: string): void {
  lastComputerTurns.set(botId, history.some(row => row.turnId === turnId && row.role === "bot" && row.tool && toolSurfaceKind(row.tool.name) === "computer"));
}

export function shouldPrewakeComputer(input: ComputerPrewakeInput): boolean {
  const likely = input.enabled && input.ownComputer && (input.place === undefined || input.place === "auto" || input.place === "cloud")
    && (/\b(?:computer|browser|open|website|app|tab|screen|download)\b/i.test(input.message)
      || ((input.botId ? lastComputerTurns.get(input.botId) : undefined) ?? lastTurnUsedComputer(input.history, input.currentMessageId)));
  if (input.botId) likelyThisTurn.set(input.botId, likely);
  return likely;
}

/** Whether the turn being set up for this bot will likely use its computer (the last shouldPrewakeComputer answer), once. */
export function takeComputerLikely(botId: string): boolean {
  const likely = likelyThisTurn.get(botId) ?? false;
  likelyThisTurn.delete(botId);
  return likely;
}

export function prewakeComputer(relay: Pick<ComputerRelay, "asleep" | "wake">, owner: RelayOwner, input: ComputerPrewakeInput): void {
  if (shouldPrewakeComputer(input) && relay.asleep(owner)) void relay.wake(owner).catch(() => {});
}
