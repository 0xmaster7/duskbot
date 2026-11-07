// Bot-to-bot traffic in a chat folds into one centered line, the way grok's agent-comm groups read:
// "Messaged <bot>", "Message from <bot>", "3 messages with <bot>".
import type { Message } from "@/state/store";
import type { WireMessage } from "../../shared/wire";
import { failedTurnCause } from "../../shared/failed-turn";
import { peerLine, peerRequest } from "@/lib/peer-message";
import { isStatusActivity } from "@/lib/activity-runs";
import { isCancelledTranscriptRow } from "../../shared/client-cancel";

export interface PeerRef { id?: string; name: string; color?: string }
export interface PeerEntry {
  direction: "inbound" | "outbound"; peer: PeerRef;
  /** A step of the reply rather than a message: it folds with the exchange but is not counted. */
  step?: true;
}

export type ExchangeSummary =
  | { kind: "single"; direction: "inbound" | "outbound"; peer: PeerRef }
  | { kind: "fanout"; peers: PeerRef[] }
  | { kind: "thread"; count: number; peers: PeerRef[] };

const peerKey = (peer: PeerRef) => peer.id ?? `name:${peer.name}`;

/** A row another bot sent here, or one this chat's bot sent to another bot. Rows that need the person stay out. */
function activityEntry(m: Message): PeerEntry | null {
  const tool = m.tool;
  if (m.kind !== "activity" || !tool || m.relay || (!m.threadRef && !m.comm)) return null;
  // a hand-off line is read as its own row in the chat, never folded into "Messaged X"
  if (m.handoff && tool.ok !== false) return null;
  const target = m.threadRef?.botId ?? m.comm?.withBotId;
  if (m.roomRequest?.phase === "result") {
    const id = m.from?.botId ?? target;
    return { direction: "inbound", peer: { id, name: m.from?.name ?? m.comm?.withName ?? "", color: m.from?.color ?? m.comm?.withColor } };
  }
  // "X needs your input" is the asking bot's own row: it waits on the person, so it keeps its chip
  if (m.from && m.from.botId === target) return null;
  // a post a bot made into a room names the room, not a bot
  if (m.comm && m.comm.withBotId === m.from?.botId) return null;
  if (m.comm && !m.from && !m.comm.threadId) return null;
  if (tool.ok === false) return null;
  return { direction: "outbound", peer: { id: target, name: m.sentDirectly?.name ?? m.comm?.withName ?? "", color: m.comm?.withColor } };
}

const REPLY_KINDS = new Set<Message["kind"]>(["text", "activity", "digest"]);
const REPLY_WINDOW_MS = 15 * 60_000;

/** Which of a transcript's rows are bot-to-bot traffic, and with whom. A reply this bot wrote to another bot's line
 * belongs to that exchange (its request is the peer's line); cards and failures that wait on the person never do. */
export function exchangeEntries(messages: readonly Message[], threadBotId?: string): Map<string, PeerEntry> {
  const entries = new Map<string, PeerEntry>();
  const peerLines = new Map<string, PeerRef>();
  // without a recorded request, only a row right after the exchange, minutes later, reads as the bot answering it
  let lastRequest: { peer: PeerRef; at: number } | null = null;
  for (const m of messages) {
    if (m.role === "user") {
      const peer = peerLine(m);
      if (!peer) {
        lastRequest = null;
        continue;
      }
      const wire = m as Message & Partial<Pick<WireMessage, "aside" | "peerAsk">>;
      // an incident notice is about a bot's chat, for the person to read
      if (wire.peerAsk?.incident) continue;
      const ref = { id: peer.botId, name: peer.name };
      entries.set(m.id, { direction: "inbound", peer: ref });
      peerLines.set(m.id, ref);
      lastRequest = wire.aside ? null : { peer: ref, at: m.at };
      continue;
    }
    if (threadBotId) {
      const asked = peerRequest(m, threadBotId);
      if (asked) {
        entries.set(m.id, { direction: "inbound", peer: { id: asked.botId, name: asked.name, color: m.from?.color } });
        continue;
      }
    }
    const activity = activityEntry(m);
    if (activity) {
      entries.set(m.id, activity);
      continue;
    }
    const replies = REPLY_KINDS.has(m.kind) && !m.automation && !(m.kind === "activity" && (m.threadRef || m.comm || m.relay || m.dataResult
      || (m.tool && failedTurnCause(m.tool.name) !== null) || isStatusActivity(m))) && !isCancelledTranscriptRow(m);
    const recent = lastRequest && m.at - lastRequest.at <= REPLY_WINDOW_MS ? lastRequest.peer : null;
    const to = !replies ? null : m.requestMessageId ? peerLines.get(m.requestMessageId) ?? null : recent;
    if (to) {
      entries.set(m.id, { direction: "outbound", peer: to, ...(m.kind === "text" ? {} : { step: true as const }) });
      if (lastRequest) lastRequest.at = m.at;
    } else lastRequest = null;
  }
  return entries;
}

/** grok's summary of one run of exchange rows: one row is "Messaged X" or "Message from X"; one message to each of
 * several bots is a fan-out; anything else counts the messages. */
export function exchangeSummary(all: readonly PeerEntry[]): ExchangeSummary | null {
  const said = all.filter((entry) => !entry.step);
  const entries = said.length ? said : all;
  const first = entries[0];
  if (!first) return null;
  const peers = new Map<string, PeerRef>();
  for (const entry of entries) {
    const key = peerKey(entry.peer);
    const known = peers.get(key);
    peers.set(key, known && known.name ? known : entry.peer);
  }
  const unique = [...peers.values()];
  if (entries.length === 1) return { kind: "single", direction: first.direction, peer: first.peer };
  if (unique.length >= 2 && entries.length === unique.length && entries.every((entry) => entry.direction === "outbound")) {
    return { kind: "fanout", peers: unique };
  }
  return { kind: "thread", count: entries.length, peers: unique };
}

export interface ExchangeRun<T> { id: string; start: number; end: number; items: T[]; entries: PeerEntry[]; summary: ExchangeSummary }

/** Consecutive transcript items whose rows are all exchange traffic, folded into runs. `transparent` items (rows
 * the chat draws nothing for) neither break a run nor count in it. */
export function exchangeRuns<T>(
  items: readonly T[],
  rowsOf: (item: T) => readonly Message[],
  entries: ReadonlyMap<string, PeerEntry>,
  transparent: (item: T) => boolean = () => false,
): ExchangeRun<T>[] {
  const runs: ExchangeRun<T>[] = [];
  let open: { start: number; end: number; items: T[]; entries: PeerEntry[] } | null = null;
  const close = () => {
    if (open && open.entries.some((entry) => !entry.step)) {
      const summary = exchangeSummary(open.entries);
      const firstRow = rowsOf(open.items[0]!)[0];
      if (summary && firstRow) runs.push({ id: `exchange:${firstRow.id}`, ...open, summary });
    }
    open = null;
  };
  items.forEach((item, index) => {
    const rows = rowsOf(item);
    const inExchange = rows.length > 0 && rows.every((row) => entries.has(row.id));
    if (inExchange) {
      if (!open) open = { start: index, end: index, items: [], entries: [] };
      open.items.push(item);
      open.end = index;
      for (const row of rows) open.entries.push(entries.get(row.id)!);
      return;
    }
    if (open && transparent(item)) return;
    close();
  });
  close();
  return runs;
}
