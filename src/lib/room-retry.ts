import { isMentionBoundary, isMentionNameContinuation } from "../../shared/mention-boundary.ts";
import { resolveMentions } from "../../shared/room-mentions.ts";
import type { WireMessage } from "../../shared/wire.ts";
import { escapeAttribute } from "./composer-attachments.ts";
import { peerLine } from "./peer-message.ts";

type RetryMessage = Pick<WireMessage, "id" | "role" | "kind" | "text" | "attachments" | "channelMode" | "replyToId" | "peerAsk">;

export interface RoomRetryRequest {
  messageId: string;
  text: string;
  mode: "chat" | "goal";
  replyToId?: string;
}

function attachmentTags(message: RetryMessage, text: string): string[] {
  const tags: string[] = [];
  for (const attachment of message.attachments ?? []) {
    const path = escapeAttribute(attachment.path);
    if (text.includes(`path="${path}"`)) continue;
    const name = escapeAttribute(attachment.kind === "file" ? attachment.name : attachment.path.split(/[\\/]/).at(-1) ?? attachment.path);
    tags.push(`<${attachment.kind === "image" ? "attached-image" : "attached-file"} path="${path}" name="${name}" />`);
  }
  return tags;
}

export function roomRetryRequest(transcript: readonly RetryMessage[], stoppedIndex: number): RoomRetryRequest | null {
  for (let index = stoppedIndex - 1; index >= 0; index -= 1) {
    const message = transcript[index];
    if (!message || message.role !== "user") continue;
    if (peerLine(message) || message.kind !== "text" || message.id.startsWith("optimistic-")) return null;
    const base = message.text?.trim() ?? "";
    const text = [base, ...attachmentTags(message, base)].filter(Boolean).join("\n\n");
    if (!text) return null;
    return {
      messageId: message.id,
      text,
      mode: message.channelMode ?? "chat",
      ...(message.replyToId ? { replyToId: message.replyToId } : {}),
    };
  }
  return null;
}

interface RetryMember { id: string; name: string }

/** The person's line again for just the members that didn't answer it: a tag is what routes a room line, so every other
 * member's @tag comes out and each of theirs the line lacks goes in front. */
export function roomRetryText(text: string, members: readonly RetryMember[], retryIds: readonly string[]): string {
  const others = members.filter((member) => !retryIds.includes(member.id) && member.name.trim()).sort((a, b) => b.name.length - a.name.length);
  let kept = "";
  for (let at = 0; at < text.length; at += 1) {
    if (text[at] === "@" && isMentionBoundary(text, at)) {
      const rest = text.slice(at + 1);
      const tagged = others.find((member) => rest.slice(0, member.name.length).toLowerCase() === member.name.toLowerCase()
        && !isMentionNameContinuation(rest.slice(member.name.length)));
      if (tagged) {
        at += tagged.name.length;
        if (text[at + 1] === " " && (kept === "" || /\s$/u.test(kept))) at += 1;
        continue;
      }
    }
    kept += text[at];
  }
  const already = new Set(resolveMentions(kept, members).bots.map((member) => member.id));
  const missing = retryIds.flatMap((id) => {
    const member = members.find((candidate) => candidate.id === id);
    return member && !already.has(id) ? [`@${member.name}`] : [];
  });
  return [...missing, kept.trim()].filter(Boolean).join(" ");
}
