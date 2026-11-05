import { useState } from "react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { shortPath } from "@/lib/short-path";
import type { Bot } from "@/state/store";
import { useDesktopCapabilities } from "../../DesktopCapabilities";
import { GrokIcon } from "../../GrokIcon";
import { useWorkingFolder } from "../../bot-settings/AccessSection";
import { DialogChoice, DialogSection, footnoteCls, GrokDialog, rowButtonCls } from "../../ui/GrokDialog";

const pathBoxCls = "flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-[10px] border border-ink/12 bg-ink/4 px-2.5 font-mono text-[12px] leading-4 text-ink";

/** Where the bot keeps and edits files: its own private folder, or one the person picks, shown as a path. */
export function FolderModal({ bot, onClose }: { bot: Bot; onClose: () => void }) {
  const { capabilities } = useDesktopCapabilities();
  const home = capabilities.host?.homeDir;
  const { draft, setDraft, error, saving, canPick, save, pick } = useWorkingFolder(bot);
  const [choosing, setChoosing] = useState(false);
  const chosen = Boolean(bot.cwd) || choosing;
  const editable = bot.yourAccess !== "view";

  return (
    <GrokDialog
      data-panel-modal="folder"
      title={t("computer.files.folder")}
      description={t("botPanel.folder.intro", { name: bot.name })}
      onClose={onClose}
    >
      <div className="flex flex-col gap-2.5">
        <DialogSection>
          <div role="radiogroup" aria-label={t("computer.files.folder")} className="flex flex-col">
            <DialogChoice
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
            <DialogChoice
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
                <div className="flex items-center gap-2 pb-2 pl-[58px] pr-3.5 pt-0.5">
                  <span data-folder-path title={bot.cwd} className={pathBoxCls}>
                    <span aria-hidden="true" className="flex shrink-0 text-ink/56"><GrokIcon name="folder" size={12} /></span>
                    <span className="min-w-0 truncate">{bot.cwd ? shortPath(bot.cwd, home) : <span className="text-ink/56">No folder yet</span>}</span>
                  </span>
                  <button type="button" data-panel-action="pick-folder" disabled={saving || !editable} onClick={() => void pick()} className={rowButtonCls}>
                    {bot.cwd ? "Change" : "Choose folder"}
                  </button>
                </div>
              ) : (
                <form
                  data-panel-form="folder-path"
                  className="flex items-center gap-2 pb-2 pl-[58px] pr-3.5 pt-0.5"
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
                    className={cn(pathBoxCls, "outline-none transition-[border-color] duration-[120ms] ease-[ease] placeholder:text-ink/56 focus:border-ink/40! disabled:opacity-50")}
                  />
                  <button type="submit" disabled={saving || draft === null} className={rowButtonCls}>{t("botAccess.folder.save")}</button>
                </form>
              ))}
            </DialogChoice>
          </div>
        </DialogSection>
        {error && <p role="alert" className={cn(footnoteCls, "text-warning")}>{error}</p>}
      </div>
    </GrokDialog>
  );
}
