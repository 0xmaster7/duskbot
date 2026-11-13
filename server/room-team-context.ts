// What a room member knows about the others: what each is for, and which parts of this conversation are already in hand.
import { peerName } from "./peer-roster.ts";

type Member = { id: string; name: string; title?: string; description?: string; hidden?: boolean };

const oneLine = (value: string | undefined, max: number) => {
  const flat = (value ?? "").replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

/** Each teammate's role and what they do, so a member knows whose part a piece of work is; "" when nobody says. */
export function teammatesNote(members: readonly Member[], selfId: string): string {
  const team = members.filter((member) => member.id !== selfId && !member.hidden);
  const lines = team.flatMap((member) => {
    const about = [oneLine(member.title, 80), oneLine(member.description, 160)].filter(Boolean).join(": ");
    return about ? [`- ${peerName(member.name)}: ${about}`] : [];
  });
  if (!lines.length) return "";
  return ["What your teammates here do (leave a part to the one it fits; take it on yourself only when it's yours or nobody else's):", ...lines].join("\n");
}

export type InHand = { botName: string; task: string; state: "queued" | "running" | "waiting" };

const STATE_WORDS: Record<InHand["state"], string> = { queued: "about to start", running: "working on it", waiting: "waiting on an answer" };

/** Work teammates were handed in this conversation and have not reported on yet. */
export function workInProgressNote(rows: readonly InHand[]): string {
  if (!rows.length) return "";
  return [
    "Already in hand in this conversation (don't start these yourself; build on them, or wait for the result):",
    ...rows.slice(0, 8).map((row) => `- ${peerName(row.botName)} (${STATE_WORDS[row.state]}): ${JSON.stringify(oneLine(row.task, 200))}`),
  ].join("\n");
}
