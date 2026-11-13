// Notes from another AI, as the chat takes them: pasted or dropped into any chat, and one quiet line in the first bot's
// chat while they are on their way.
import { useCallback, useEffect, useState } from "react";
import { X } from "../icons";
import { copyNotesPrompt, importNotes, isNotesPrompt, notesErrorLine, notesOutcomeLine, scheduleNotesReminder, stopWaiting, useNotesWaiting } from "@/lib/assistant-notes";
import { myDefaultBot, useViewerEmail } from "@/lib/default-bot";
import { t } from "@/lib/i18n";
import { useStore } from "@/state/store";

/** Takes a pasted or dropped block: `say` hears "bringing in…" at once, then the outcome or what went wrong. */
export function useNotesIntake() {
  const { state, dispatch } = useStore();
  const firstBotId = myDefaultBot(state.bots, useViewerEmail())?.id ?? null;
  return useCallback((text: string, say: (line: string) => void) => {
    if (isNotesPrompt(text)) { say(t("composer.notes.error.prompt")); return; }
    say(t("composer.notes.working"));
    void importNotes(text, { bots: state.bots, aboutMe: state.config?.profile?.aboutMe ?? "", team: Boolean(state.config?.team), firstBotId, dispatch })
      .then(notesOutcomeLine, notesErrorLine).then(say);
  }, [state.bots, state.config?.profile?.aboutMe, state.config?.team, firstBotId, dispatch]);
}

/** One reminder 15 minutes after the prompt was copied, while its answer hasn't come: a system notification that opens
 * the first bot's chat. Without permission for one, the waiting line in that chat is the reminder. */
export function useNotesReminder() {
  const { state, dispatch } = useStore();
  const waiting = useNotesWaiting();
  const firstBotId = myDefaultBot(state.bots, useViewerEmail())?.id;
  useEffect(() => {
    if (!waiting || waiting.reminded || !firstBotId) return;
    return scheduleNotesReminder(() => {
      if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
      try {
        new Notification(t("composer.notes.remindTitle"), { body: t("composer.notes.remindBody"), tag: "duskbot:notes", silent: true }).onclick = () => {
          window.focus();
          dispatch({ type: "select", id: firstBotId });
        };
      } catch {}
    });
  }, [waiting, firstBotId, dispatch]);
}

/** In the first bot's chat while notes are on their way: what to do with them, the prompt again, and a way to stop. */
export function NotesWaitingLine({ botId }: { botId: string | undefined }) {
  const { state } = useStore();
  const waiting = useNotesWaiting();
  const first = myDefaultBot(state.bots, useViewerEmail());
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2_000);
    return () => clearTimeout(timer);
  }, [copied]);
  if (!waiting || !botId || botId !== first?.id) return null;
  return (
    <div data-notes-waiting="" className="mb-2 flex items-center gap-2 rounded-[14px] bg-ink/[0.04] py-1.5 pe-1.5 ps-3 text-[13px] leading-[18px] text-ink-secondary">
      <span aria-hidden="true" className="funnel-wait inline-block size-1.5 shrink-0 rounded-full bg-ink/60" />
      <span className="min-w-0 flex-1 text-pretty">{t("composer.notes.waiting")}</span>
      <button type="button" data-notes-copy="" onClick={() => void copyNotesPrompt().then(setCopied)}
        className="shrink-0 rounded-full px-2 py-1 text-ink transition-colors hover:bg-ink/[0.06] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus motion-reduce:transition-none">
        {copied ? t("composer.notes.copied") : t("composer.notes.copyAgain")}
      </button>
      <button type="button" data-notes-stop="" onClick={stopWaiting} aria-label={t("composer.notes.stopWaiting")} title={t("composer.notes.stopWaiting")}
        className="grid size-7 shrink-0 place-items-center rounded-full text-ink-tertiary transition-colors hover:bg-ink/[0.06] hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus motion-reduce:transition-none">
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}
