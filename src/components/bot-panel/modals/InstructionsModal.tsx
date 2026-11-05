import { useId, useState } from "react";

import { BOT_PROFILE_LIMITS } from "../../../../shared/bot-profile";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { soulPatchFor, utf8Bytes } from "@/lib/soul";
import type { Bot } from "@/state/store";
import { BotAvatar } from "../../Avatar";
import type { useBotSettingsDerived } from "../../bot-settings/useBotSettingsDerived";
import { fieldCls, kitPrimaryCls, kitSecondaryCls, ModalSheet, rowHintCls } from "./ModalSheet";

/** The bot's instructions in a roomy editor: a draft until Save, so Cancel or Escape leaves them as they were. */
export function InstructionsModal({ bot, derived, onClose }: {
  bot: Bot;
  derived: ReturnType<typeof useBotSettingsDerived>;
  onClose: () => void;
}) {
  const limit = BOT_PROFILE_LIMITS.soul;
  const saved = bot.soul ?? "";
  const [draft, setDraft] = useState(saved);
  const fieldId = useId();
  const bytes = utf8Bytes(draft);
  const over = bytes > limit;
  const editable = bot.yourAccess !== "view";
  const canSave = editable && !over && draft !== saved;

  const save = () => {
    const patch = soulPatchFor(draft, limit);
    if (!canSave || !patch) return;
    derived.patch(patch);
    onClose();
  };

  return (
    <ModalSheet
      data-panel-modal="instructions"
      width={560}
      title={t("botSettings.simple.instructions")}
      leading={<span className="-my-1 flex shrink-0"><BotAvatar bot={bot} size={24} /></span>}
      onClose={onClose}
      footer={(
        <>
          <span
            data-instructions-count
            aria-live="polite"
            className={cn("mr-auto text-[12px] leading-4 tabular-nums tracking-[0.01em]", over ? "text-danger" : "text-ink/56")}
          >
            {over ? `Too long to save. ${bytes.toLocaleString()} / ${limit.toLocaleString()}` : `${bytes.toLocaleString()} / ${limit.toLocaleString()}`}
          </span>
          <button type="button" onClick={onClose} className={kitSecondaryCls}><span>{t("common.cancel")}</span></button>
          <button type="button" data-modal-action="save" disabled={!canSave} onClick={save} className={kitPrimaryCls}><span>{t("common.save")}</span></button>
        </>
      )}
    >
      <label htmlFor={fieldId} className={cn(rowHintCls, "mb-2.5 block px-0.5")}>
        {t("botSettings.simple.instructionsPlaceholder", { name: bot.name })}
      </label>
      <textarea
        id={fieldId}
        data-autofocus
        value={draft}
        disabled={!editable}
        aria-invalid={over || undefined}
        placeholder={t("botPanel.instructionsHint", { name: bot.name })}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) {
            event.preventDefault();
            save();
          }
        }}
        className={cn(fieldCls, "block h-[min(360px,calc(100dvh-260px))] min-h-[180px] resize-none px-3 py-2.5 text-[14px] leading-[22px] tracking-[0.01em] [scrollbar-width:thin]", over && "border-danger/60 focus:border-danger/60!")}
      />
    </ModalSheet>
  );
}
