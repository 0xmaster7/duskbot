import { useRef } from "react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { shortModelLabel } from "@/lib/model-friendly";
import { modelName, providerName } from "@/lib/simple-model-menu";
import { useStore, type Bot } from "@/state/store";
import { GrokIcon } from "../../GrokIcon";
import { InstanceProviderMark } from "../../ProviderIcons";
import type { useBotSettingsDerived } from "../../bot-settings/useBotSettingsDerived";
import { DialogEmpty, DialogSection, footnoteCls, GrokDialog, listRowCls, RowIconButton, rowHintCls, rowTitleCls } from "../../ui/GrokDialog";
import { BackupChooser, MAX_BACKUPS, modelKey, type Backup } from "../BackupAis";

const chooserRowCls = "mx-1.5 flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-[10px] px-2 text-left transition-[background-color] duration-[120ms] ease-[ease] hover:bg-ink/5 aria-expanded:bg-ink/6 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus disabled:cursor-default";

/** The bot's backup AIs as an ordered list under its own: change one, move it up or down, remove it, add another. */
export function BackupsModal({ bot, derived, onClose }: {
  bot: Bot;
  derived: ReturnType<typeof useBotSettingsDerived>;
  onClose: () => void;
}) {
  const { state } = useStore();
  const chain = bot.fallback ?? [];
  const addRef = useRef<HTMLButtonElement>(null);
  const editable = bot.yourAccess !== "view";
  const onChange = (fallback: Backup[]) => derived.patch({ fallback });
  const others = (except: number | null) => new Set([bot.modelSelection, ...chain.filter((_, index) => index !== except)]
    .map((entry) => modelKey(entry.instanceId, entry.model)));
  const describe = (entry: Backup) => {
    const instance = state.instances.find((candidate) => candidate.instanceId === entry.instanceId);
    const option = instance?.models.options.find((candidate) => candidate.id === entry.model);
    const name = modelName(instance, entry.model);
    return { instance, name, short: instance && option ? shortModelLabel(option.label, providerName(instance)) : name };
  };
  const move = (from: number, to: number) => {
    if (to < 0 || to >= chain.length) return;
    const next = [...chain];
    const [entry] = next.splice(from, 1);
    next.splice(to, 0, entry!);
    onChange(next);
  };
  const main = describe(bot.modelSelection);

  const mark = (instance: ReturnType<typeof describe>["instance"]) => instance
    ? <InstanceProviderMark instance={instance} size={16} />
    : <span className="size-4 shrink-0 rounded-full bg-ink/8" aria-hidden="true" />;

  return (
    <GrokDialog
      data-panel-modal="backups"
      title={t("botPanel.backups.title")}
      description={`If ${bot.name}'s AI hits its limit or can't start, the first one here takes over.`}
      onClose={onClose}
    >
      <div className="flex flex-col gap-7">
        <DialogSection label="Main AI">
          <div data-backup-main title={t("botPanel.backups.hint", { name: bot.name })} className={cn(listRowCls, "gap-x-2.5")}>
            {mark(main.instance)}
            <span className={cn(rowTitleCls, "min-w-0 flex-1 truncate")}>{main.short}</span>
            {main.instance && <span className={cn(rowHintCls, "min-w-0 shrink truncate")}>{main.instance.displayName}</span>}
          </div>
        </DialogSection>

        <div className="flex flex-col gap-2.5">
          <DialogSection label={chain.length ? "Backups, in order" : "Backups"}>
            {chain.length === 0 && !(editable && chain.length < MAX_BACKUPS) && <DialogEmpty>No backups yet.</DialogEmpty>}
            {chain.length > 0 && (
              <ol aria-label={t("botPanel.backups.title")} className="m-0 flex list-none flex-col p-0">
                {chain.map((entry, index) => {
                  const { instance, name, short } = describe(entry);
                  return (
                    <li key={modelKey(entry.instanceId, entry.model)} data-backup={entry.instanceId} className="group/row flex min-h-11 items-center pr-2.5">
                      <BackupChooser
                        bot={bot}
                        current={entry}
                        exclude={others(index)}
                        onPick={(picked) => onChange(chain.map((candidate, at) => (at === index ? picked : candidate)))}
                        label={t("botPanel.backups.row", { position: index + 1, model: name })}
                        title={instance ? `${instance.displayName}: ${name}` : name}
                        data-panel-action="backup-change"
                        className={chooserRowCls}
                      >
                        <span className="w-4 shrink-0 text-center text-[12px] tabular-nums text-ink/40" aria-hidden="true">{index + 1}</span>
                        {mark(instance)}
                        <span className={cn(rowTitleCls, "min-w-0 truncate")}>{short}</span>
                        {instance
                          ? <span className={cn(rowHintCls, "min-w-0 shrink truncate")}>{instance.displayName}</span>
                          : <span className="shrink-0 text-[12px] text-warning">{t("model.simple.unavailable")}</span>}
                        <span aria-hidden="true" className="ml-auto flex shrink-0 text-ink/40"><GrokIcon name="chevron-down-small" size={14} /></span>
                      </BackupChooser>
                      {editable && (
                        <span className="flex shrink-0 items-center">
                          {chain.length > 1 && (
                            <>
                              <RowIconButton reveal icon="arrow-up" data-modal-action="backup-up" label={`Move ${name} up`} disabled={index === 0} onClick={() => move(index, index - 1)} />
                              <RowIconButton reveal icon="arrow-down" data-modal-action="backup-down" label={`Move ${name} down`} disabled={index === chain.length - 1} onClick={() => move(index, index + 1)} />
                            </>
                          )}
                          <RowIconButton
                            reveal
                            icon="trash"
                            data-modal-action="backup-remove"
                            label={t("botPanel.backups.remove", { model: name })}
                            onClick={() => {
                              onChange(chain.filter((_, at) => at !== index));
                              addRef.current?.focus({ preventScroll: true });
                            }}
                          />
                        </span>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
            {editable && chain.length < MAX_BACKUPS && (
              <div className="flex">
                <BackupChooser
                  bot={bot}
                  current={null}
                  exclude={others(null)}
                  onPick={(picked) => onChange([...chain, picked])}
                  label={t("model.fallback.add")}
                  buttonRef={addRef}
                  data-panel-action="backup-add"
                  className={cn(chooserRowCls, "text-[13px] leading-[18px] tracking-[-0.08px] text-ink")}
                >
                  <span aria-hidden="true" className="flex size-5 shrink-0 items-center justify-center rounded-full bg-ink/6 text-ink/80"><GrokIcon name="plus" size={12} /></span>
                  {t("model.fallback.add")}
                </BackupChooser>
              </div>
            )}
          </DialogSection>
          {chain.length === 0 && editable && <p className={footnoteCls}>No backups yet. {bot.name} waits for its own AI until you add one.</p>}
          {chain.length >= MAX_BACKUPS && <p className={footnoteCls}>That's the most a bot can keep.</p>}
        </div>
      </div>
    </GrokDialog>
  );
}
