import { useState } from "react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { shortPath } from "@/lib/short-path";
import type { Bot } from "@/state/store";
import { useDesktopCapabilities } from "../../DesktopCapabilities";
import { GrokIcon } from "../../GrokIcon";
import { useWorkingFolder } from "../../bot-settings/AccessSection";
import { ChoiceCard } from "./ChoiceCard";
import { fieldCls, kitPrimaryCls, kitSecondaryCls, ModalSheet, rowHintCls } from "./ModalSheet";

/** Where the bot keeps and edits files: its own private folder, or one the person picks, shown as a path pill. */
export function FolderModal({ bot, onClose }: { bot: Bot; onClose: () => void }) {
  const { capabilities } = useDesktopCapabilities();
  const home = capabilities.host?.homeDir;
  const { draft, setDraft, error, saving, canPick, save, pick } = useWorkingFolder(bot);
  const [choosing, setChoosing] = useState(false);
  const chosen = Boolean(bot.cwd) || choosing;
  const editable = bot.yourAccess !== "view";

  return (
    <ModalSheet
      data-panel-modal="folder"
      width={460}
      title={t("computer.files.folder")}
      onClose={onClose}
      footer={<button type="button" onClick={onClose} className={kitPrimaryCls}><span>{t("common.done")}</span></button>}
    >
      <p className={cn(rowHintCls, "mb-3 px-0.5")}>{t("botPanel.folder.intro", { name: bot.name })}</p>
      <div role="radiogroup" aria-label={t("computer.files.folder")} className="flex flex-col gap-2">
        <ChoiceCard
          data-panel-choice="private"
          icon="lock"
          title={t("botPanel.folder.own")}
          hint={t("botPanel.folder.ownHint")}
          checked={!chosen}
          disabled={saving || !editable}
          onSelect={() => {
            setChoosing(false);
            if (bot.cwd) void save(null);
          }}
        />
        <ChoiceCard
          data-panel-choice="pick"
          icon="folder"
          title={t("botPanel.folder.pick")}
          hint={t("botPanel.folder.pickHint")}
          checked={chosen}
          disabled={saving || !editable}
          onSelect={() => {
            if (bot.cwd) return;
            if (canPick) void pick();
            else setChoosing(true);
          }}
        >
          {chosen && (canPick ? (
            <div className="flex items-center gap-2 px-3 pb-3 pl-[60px]">
              <span
                data-folder-path
                title={bot.cwd}
                className="flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-full bg-ink/[0.05] px-3 font-mono text-[12px] leading-4 text-ink"
              >
                <span aria-hidden="true" className="flex shrink-0 text-ink/56"><GrokIcon name="folder" size={12} /></span>
                <span className="min-w-0 truncate">{bot.cwd ? shortPath(bot.cwd, home) : <span className="text-ink/56">No folder yet</span>}</span>
              </span>
              <button type="button" data-panel-action="pick-folder" disabled={saving || !editable} onClick={() => void pick()} className={kitSecondaryCls}>
                <span>{bot.cwd ? "Change" : "Choose folder"}</span>
              </button>
            </div>
          ) : (
            <form
              data-panel-form="folder-path"
              className="flex items-center gap-2 px-3 pb-3 pl-[60px]"
              onSubmit={(event) => {
                event.preventDefault();
                const path = (draft ?? bot.cwd ?? "").trim();
                if (path) void save(path);
              }}
            >
              <input
                value={draft ?? bot.cwd ?? ""}
                placeholder={t("botAccess.folder.placeholder")}
                aria-label={t("botAccess.folder.title")}
                disabled={!editable}
                onChange={(event) => setDraft(event.target.value)}
                className={cn(fieldCls, "h-8 min-w-0 flex-1 rounded-full px-3 py-1.5 font-mono text-[12px] tracking-normal")}
              />
              <button type="submit" disabled={saving || draft === null} className={kitSecondaryCls}><span>{t("botAccess.folder.save")}</span></button>
            </form>
          ))}
        </ChoiceCard>
      </div>
      {error && <p role="alert" className={cn(rowHintCls, "mt-3 px-0.5 text-warning")}>{error}</p>}
    </ModalSheet>
  );
}
