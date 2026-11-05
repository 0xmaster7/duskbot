import { useRef } from "react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { shortModelLabel } from "@/lib/model-friendly";
import { modelName, providerName } from "@/lib/simple-model-menu";
import { useStore, type Bot } from "@/state/store";
import { GrokIcon } from "../../GrokIcon";
import { InstanceProviderMark } from "../../ProviderIcons";
import type { useBotSettingsDerived } from "../../bot-settings/useBotSettingsDerived";
import { BackupChooser, MAX_BACKUPS, modelKey, type Backup } from "../BackupAis";
import { kitPrimaryCls, ListGroup, listRowCls, ModalSheet, RowIconButton, rowHintCls, rowTitleCls } from "./ModalSheet";

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
    : <span className="size-4 shrink-0 rounded-full bg-ink/[0.08]" aria-hidden="true" />;

  return (
    <ModalSheet
      data-panel-modal="backups"
      width={480}
      title={t("botPanel.backups.title")}
      onClose={onClose}
      footer={<button type="button" onClick={onClose} className={kitPrimaryCls}><span>{t("common.done")}</span></button>}
    >
      <div className="flex flex-col gap-5">
        <p className={cn(rowHintCls, "-mb-1 px-0.5")} title={t("botPanel.backups.hint", { name: bot.name })}>
          If {bot.name}'s AI hits its limit or can't start, the first one here takes over.
        </p>
        <ListGroup>
          <div data-backup-main className={cn(listRowCls, "min-h-11 gap-x-2.5 py-2")}>
            {mark(main.instance)}
            <span className={cn(rowTitleCls, "min-w-0 flex-1 truncate")}>{main.short}</span>
            <span className="shrink-0 rounded-full bg-ink/[0.05] px-2 py-0.5 text-[12px] leading-4 text-ink-secondary">Main AI</span>
          </div>
          {chain.length > 0 && (
            <ol aria-label={t("botPanel.backups.title")} className="m-0 flex list-none flex-col border-t border-ink/[0.06] p-0 pt-1">
              {chain.map((entry, index) => {
                const { instance, name, short } = describe(entry);
                return (
                  <li key={modelKey(entry.instanceId, entry.model)} data-backup={entry.instanceId} className={cn("group/row", listRowCls, "min-h-11 gap-x-2 py-1.5 pl-3.5 pr-2")}>
                    <span className="w-4 shrink-0 text-center text-[12px] tabular-nums text-ink/40" aria-hidden="true">{index + 1}</span>
                    <BackupChooser
                      bot={bot}
                      current={entry}
                      exclude={others(index)}
                      onPick={(picked) => onChange(chain.map((candidate, at) => (at === index ? picked : candidate)))}
                      label={t("botPanel.backups.row", { position: index + 1, model: name })}
                      title={instance ? `${instance.displayName}: ${name}` : name}
                      data-panel-action="backup-change"
                      className="-ml-1 flex h-8 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-[8px] px-1.5 text-left transition-[background-color] duration-[120ms] ease-[ease] hover:bg-ink/[0.04] aria-expanded:bg-ink/[0.06] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus disabled:cursor-default"
                    >
                      {mark(instance)}
                      <span className={cn(rowTitleCls, "min-w-0 truncate")}>{short}</span>
                      {instance
                        ? <span className={cn(rowHintCls, "min-w-0 shrink truncate")}>{instance.displayName}</span>
                        : <span className="shrink-0 text-[12px] text-warning">{t("model.simple.unavailable")}</span>}
                      <span aria-hidden="true" className="flex ml-auto shrink-0 text-ink/40"><GrokIcon name="chevron-down-small" size={14} /></span>
                    </BackupChooser>
                    {editable && (
                      <span className="flex shrink-0 items-center">
                        <RowIconButton reveal icon="arrow-up" data-modal-action="backup-up" label={`Move ${name} up`} disabled={index === 0} onClick={() => move(index, index - 1)} />
                        <RowIconButton reveal icon="arrow-down" data-modal-action="backup-down" label={`Move ${name} down`} disabled={index === chain.length - 1} onClick={() => move(index, index + 1)} />
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
            <div className="mx-2 mt-1 border-t border-ink/[0.06] pt-1">
              <BackupChooser
                bot={bot}
                current={null}
                exclude={others(null)}
                onPick={(picked) => onChange([...chain, picked])}
                label={t("model.fallback.add")}
                buttonRef={addRef}
                data-panel-action="backup-add"
                className="flex h-10 w-full cursor-pointer items-center gap-2.5 rounded-[8px] px-1.5 text-left text-[13px] leading-[18px] tracking-[-0.08px] text-ink transition-[background-color] duration-[120ms] ease-[ease] hover:bg-ink/[0.04] aria-expanded:bg-ink/[0.06] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus"
              >
                <span aria-hidden="true" className="flex size-5 items-center justify-center rounded-full bg-ink/[0.06] text-ink/80"><GrokIcon name="plus" size={12} /></span>
                {t("model.fallback.add")}
              </BackupChooser>
            </div>
          )}
        </ListGroup>
        {chain.length === 0 && <p className={cn(rowHintCls, "-mt-2 px-3.5")}>No backups yet. {bot.name} waits for its own AI until then.</p>}
        {chain.length >= MAX_BACKUPS && <p className={cn(rowHintCls, "-mt-2 px-3.5")}>That's the most a bot can keep.</p>}
      </div>
    </ModalSheet>
  );
}
