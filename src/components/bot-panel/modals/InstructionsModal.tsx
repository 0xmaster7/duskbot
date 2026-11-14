import { useState, type ReactNode } from "react";

import { BOT_PROFILE_LIMITS } from "../../../../shared/bot-profile";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { soulPatchFor, utf8Bytes } from "@/lib/soul";
import type { Bot } from "@/state/store";
import type { useBotSettingsDerived } from "../../bot-settings/useBotSettingsDerived";
import { CardLabel, pillPrimaryCls, SheetPane } from "../../ListRows";

// unsaved instructions per bot, kept until saved or the app reloads, so leaving the page never loses them
const drafts = new Map<string, string>();

export function clearInstructionDrafts(): void {
  drafts.clear();
}

/** The bot's instructions in one calm card: a draft until Save, kept for the session when the page or sheet closes. */
export function InstructionsModal({ bot, derived }: {
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
  const prompt = t("botPanel.ui.botSettingsSimpleInstructionsPlaceholder", { name: bot.name });

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
    <SheetPane data-panel-modal="instructions" title={t("botPanel.ui.botSettingsSimpleInstructions")}>
      <InstructionsCard
        label={prompt}
        value={draft}
        disabled={!editable}
        invalid={over}
        placeholder={t("botPanel.instructionsHint", { name: bot.name })}
        onChange={setDraft}
        onSave={save}
        canSave={canSave}
        saved={justSaved && !canSave}
        note={over
          ? <span data-instructions-count aria-live="polite" className="text-danger">{`Too long to save. ${bytes.toLocaleString()} / ${limit.toLocaleString()}`}</span>
          : !editable ? `Only people who can edit ${bot.name} can change this.` : null}
        showSave={editable}
      />
    </SheetPane>
  );
}

/** A whole setting that is a few paragraphs of text: one card under its label, the text filling it and Save at its foot. */
export function InstructionsCard({ label, value, disabled, invalid, placeholder, onChange, onSave, canSave, saved, note, showSave = true, dir }: {
  label: string;
  value: string;
  disabled?: boolean;
  invalid?: boolean;
  placeholder: string;
  onChange: (value: string) => void;
  onSave: () => void;
  canSave: boolean;
  saved: boolean;
  note?: ReactNode;
  showSave?: boolean;
  dir?: "auto";
}) {
  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <CardLabel>{label}</CardLabel>
      <div
        data-instructions-card
        className={cn(
          // no fill, and a hairline that stays as it is while you type; the caret shows where
          "flex min-h-[240px] flex-1 flex-col rounded-[12px] border bg-transparent",
          invalid ? "border-danger/60" : "border-ink/10",
        )}
      >
        <textarea
          data-autofocus
          dir={dir}
          value={value}
          disabled={disabled}
          aria-label={label}
          aria-invalid={invalid || undefined}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) {
              event.preventDefault();
              onSave();
            }
          }}
          className="block min-h-0 w-full flex-1 resize-none rounded-t-[12px] bg-transparent px-3 pb-2 pt-2.5 text-[13px] leading-[18px] tracking-[0.015em] text-ink outline-none [scrollbar-width:thin] placeholder:text-ink/40 disabled:text-ink/68"
        />
        <div className="flex min-h-11 shrink-0 items-center justify-end gap-3 py-1.5 pl-3 pr-1.5">
          {note && <span className="mr-auto text-[12px] leading-4 tabular-nums tracking-[0.01em] text-ink-secondary">{note}</span>}
          {showSave && (
            <button type="button" data-modal-action="save" disabled={!canSave} onClick={onSave} className={pillPrimaryCls}>
              {saved ? t("botPanel.ui.commonSaved") : t("botPanel.ui.commonSave")}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
