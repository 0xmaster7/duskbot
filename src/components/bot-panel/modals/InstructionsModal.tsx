import { useState } from "react";

import { BOT_PROFILE_LIMITS } from "../../../../shared/bot-profile";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { soulPatchFor, utf8Bytes } from "@/lib/soul";
import type { Bot } from "@/state/store";
import type { useBotSettingsDerived } from "../../bot-settings/useBotSettingsDerived";
import { dialogPrimaryCls, footnoteCls, GrokDialog, textAreaCls } from "../../ui/GrokDialog";

/** The bot's instructions in a roomy editor: a draft until Save, so Escape or another page leaves them as they were. */
export function InstructionsModal({ bot, derived, onClose }: {
  bot: Bot;
  derived: ReturnType<typeof useBotSettingsDerived>;
  onClose: () => void;
}) {
  const limit = BOT_PROFILE_LIMITS.soul;
  const saved = bot.soul ?? "";
  const [draft, setDraft] = useState(saved);
  const [justSaved, setJustSaved] = useState(false);
  const bytes = utf8Bytes(draft);
  const over = bytes > limit;
  const editable = bot.yourAccess !== "view";
  const canSave = editable && !over && draft !== saved;
  const nearLimit = bytes > limit * 0.8;
  const prompt = t("botSettings.simple.instructionsPlaceholder", { name: bot.name });

  const save = () => {
    const patch = soulPatchFor(draft, limit);
    if (!canSave || !patch) return;
    derived.patch(patch);
    setJustSaved(true);
  };

  return (
    <GrokDialog
      data-panel-modal="instructions"
      width={600}
      title={t("botSettings.simple.instructions")}
      description={prompt}
      onClose={onClose}
      footer={(
        <>
          {nearLimit && (
            <span
              data-instructions-count
              aria-live="polite"
              className={cn("mr-auto pl-2 text-[12px] leading-4 tabular-nums tracking-[0.01em]", over ? "text-danger" : "text-ink/56")}
            >
              {over ? `Too long to save. ${bytes.toLocaleString()} / ${limit.toLocaleString()}` : `${bytes.toLocaleString()} / ${limit.toLocaleString()}`}
            </span>
          )}
          <button type="button" data-modal-action="save" disabled={!canSave} onClick={save} className={dialogPrimaryCls}>
            {justSaved && !canSave ? t("common.saved") : t("common.save")}
          </button>
        </>
      )}
    >
      <textarea
        data-autofocus
        value={draft}
        disabled={!editable}
        aria-label={prompt}
        aria-invalid={over || undefined}
        placeholder={t("botPanel.instructionsHint", { name: bot.name })}
        onChange={(event) => { setDraft(event.target.value); setJustSaved(false); }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) {
            event.preventDefault();
            save();
          }
        }}
        className={cn(textAreaCls, "min-h-[200px] flex-1", over && "border-danger/60 focus:border-danger/70!")}
      />
      {!editable && <p className={cn(footnoteCls, "mt-3")}>Only people who can edit {bot.name} can change this.</p>}
    </GrokDialog>
  );
}
