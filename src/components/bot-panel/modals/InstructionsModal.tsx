import { useState } from "react";

import { BOT_PROFILE_LIMITS } from "../../../../shared/bot-profile";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { soulPatchFor, utf8Bytes } from "@/lib/soul";
import type { Bot } from "@/state/store";
import type { useBotSettingsDerived } from "../../bot-settings/useBotSettingsDerived";
import { DialogSection, footnoteCls, GrokDialog, mdPrimaryCls } from "../../ui/GrokDialog";

// unsaved instructions per bot, kept until saved or the app reloads, so leaving the page never loses them
const drafts = new Map<string, string>();

export function clearInstructionDrafts(): void {
  drafts.clear();
}

/** The bot's instructions in one calm card: a draft until Save, kept for the session when the page or sheet closes. */
export function InstructionsModal({ bot, derived, onClose }: {
  bot: Bot;
  derived: ReturnType<typeof useBotSettingsDerived>;
  onClose: () => void;
}) {
  const limit = BOT_PROFILE_LIMITS.soul;
  const saved = bot.soul ?? "";
  const editable = bot.yourAccess !== "view";
  const [draft, setDraftState] = useState(() => (editable ? drafts.get(bot.id) : undefined) ?? saved);
  const [justSaved, setJustSaved] = useState(false);
  const bytes = utf8Bytes(draft);
  const over = bytes > limit;
  const canSave = editable && !over && draft !== saved;
  const prompt = t("botSettings.simple.instructionsPlaceholder", { name: bot.name });

  const setDraft = (value: string) => {
    if (value === saved) drafts.delete(bot.id);
    else drafts.set(bot.id, value);
    setDraftState(value);
    setJustSaved(false);
  };

  const save = () => {
    const patch = soulPatchFor(draft, limit);
    if (!canSave || !patch) return;
    derived.patch(patch);
    drafts.delete(bot.id);
    setJustSaved(true);
  };

  return (
    <GrokDialog data-panel-modal="instructions" title={t("botSettings.simple.instructions")} onClose={onClose}>
      <DialogSection bare label={prompt} className="min-h-0 flex-1">
        <div
          data-instructions-card
          className={cn(
            "flex min-h-[240px] flex-1 flex-col rounded-[14px] bg-menu outline-1 -outline-offset-1 [outline-style:solid] transition-[outline-color] duration-[120ms] ease-[ease]",
            over ? "outline-danger/60" : "outline-ink/8 focus-within:outline-ink/20",
          )}
        >
          <textarea
            data-autofocus
            value={draft}
            disabled={!editable}
            aria-label={prompt}
            aria-invalid={over || undefined}
            placeholder={t("botPanel.instructionsHint", { name: bot.name })}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) {
                event.preventDefault();
                save();
              }
            }}
            className="block min-h-0 w-full flex-1 resize-none rounded-t-[14px] bg-transparent px-3.5 pb-2 pt-3 text-[13px] leading-[18px] tracking-[0.195px] text-ink outline-none [scrollbar-width:thin] placeholder:text-ink/40 disabled:text-ink/68"
          />
          <div className="flex min-h-12 shrink-0 items-center justify-end gap-3 py-2 pl-3.5 pr-2">
            {over && (
              <span data-instructions-count aria-live="polite" className="mr-auto text-[12px] leading-4 tabular-nums tracking-[0.01em] text-danger">
                {`Too long to save. ${bytes.toLocaleString()} / ${limit.toLocaleString()}`}
              </span>
            )}
            {!editable && <span className={cn(footnoteCls, "mr-auto pl-0")}>Only people who can edit {bot.name} can change this.</span>}
            {editable && (
              <button type="button" data-modal-action="save" disabled={!canSave} onClick={save} className={mdPrimaryCls}>
                {justSaved && !canSave ? t("common.saved") : t("common.save")}
              </button>
            )}
          </div>
        </div>
      </DialogSection>
    </GrokDialog>
  );
}
