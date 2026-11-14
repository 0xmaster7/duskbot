// The proactive bot's one suggestion to keep an eye on the person's day (server/host/proactive.ts), in the person's own
// language. Turn it on makes a daily morning routine; Not now is kept and ends it.
import { useState } from "react";
import { Loader2 } from "../icons";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { api, type Message } from "@/state/store";
import { ASK_PRIMARY_BUTTON, ASK_QUIET_BUTTON } from "./AskCard";
import { friendlyError } from "@/lib/plain-error";

export function WatchSuggestion({ threadId, message }: { threadId?: string; message: Message }) {
  const [saving, setSaving] = useState<"on" | "notNow" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const answer = message.setupSuggestion?.kind === "watch" ? message.setupSuggestion.answer : undefined;

  const reply = async (choice: "on" | "notNow") => {
    if (saving || !threadId) return;
    setSaving(choice);
    setError(null);
    try {
      await api("/api/watch/suggestion", { method: "POST", body: JSON.stringify({ threadId, messageId: message.id, answer: choice }) });
    } catch (cause) {
      setError(friendlyError(cause));
    } finally {
      setSaving(null);
    }
  };

  return (
    <div data-setup-suggestion="watch" className="max-w-[600px] text-[15px] leading-relaxed text-ink">
      <p dir="auto">{t("chat.watchSuggestion.text")}</p>
      {answer ? (
        <p dir="auto" className="mt-1 text-[13px] text-ink-secondary">{t(answer === "on" ? "chat.watchSuggestion.on" : "chat.watchSuggestion.declined")}</p>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button type="button" data-testid="watch-suggestion-on" onClick={() => void reply("on")} disabled={saving !== null} className={ASK_PRIMARY_BUTTON}>
            {saving === "on" ? <Loader2 size={14} className="animate-spin" /> : t("chat.watchSuggestion.turnOn")}
          </button>
          <button type="button" data-testid="watch-suggestion-not-now" onClick={() => void reply("notNow")} disabled={saving !== null} className={cn(ASK_QUIET_BUTTON, "my-0")}>
            {saving === "notNow" ? <Loader2 size={14} className="animate-spin" /> : t("chat.watchSuggestion.notNow")}
          </button>
        </div>
      )}
      {error && <p role="alert" className="mt-1 text-[12px] text-danger">{error}</p>}
    </div>
  );
}
