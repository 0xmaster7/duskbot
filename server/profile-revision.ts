import { createHash } from "node:crypto";

import type { ProfileRequestChanges } from "../shared/profile-request.ts";

type ProfileBot = {
  name: string; title: string; description: string; soul?: string; cwd?: string; notifications?: boolean; speakReplies?: boolean;
  color?: string; replyStyle?: string; voice?: string; voiceNotes?: boolean;
};

export function profileSnapshot(
  bot: ProfileBot,
): Required<ProfileRequestChanges> {
  return {
    name: bot.name,
    title: bot.title,
    description: bot.description,
    soul: bot.soul ?? "",
    cwd: bot.cwd ?? "",
    notifications: bot.notifications ?? true,
    speakReplies: bot.speakReplies ?? false,
    color: bot.color ?? "",
    replyStyle: bot.replyStyle ?? "default",
    voice: bot.voice ?? "",
    voiceNotes: bot.voiceNotes !== false,
  };
}

export function profileRevision(
  bot: ProfileBot & { lastProfileRequestId?: string },
): string {
  // The private receipt stops an older, interrupted card from applying restored identical text twice.
  return createHash("sha256")
    .update(JSON.stringify({ ...profileSnapshot(bot), lastProfileRequestId: bot.lastProfileRequestId ?? "" }), "utf8")
    .digest("hex");
}
