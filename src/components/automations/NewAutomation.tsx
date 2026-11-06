import { useRef, useState } from "react";

import { useModalDialog } from "@/hooks/use-modal-dialog";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { imeComposing } from "@/lib/send-key";
import { useStore, type Bot } from "@/state/store";
import { GrokIcon, type GrokIconName } from "../GrokIcon";
import { Select } from "../Select";
import { DialogChoice, formBodyCls, formCloseCls, formFooterCls, formHeaderCls, formSheetCls, formTitleCls, listCardCls, mdPrimaryCls, mdSecondaryCls, textAreaCls } from "../ui/GrokDialog";

export type SetUpKind = "schedule" | "webhook" | "app";

/** The bot "+ New" talks to: the one open now, else the one most recently talked to. */
export function defaultBot(bots: readonly Bot[], selectedId: string): Bot | undefined {
  const open = bots.find((bot) => bot.id === selectedId);
  if (open) return open;
  const lastAt = (bot: Bot) => bot.messages.at(-1)?.at ?? 0;
  return [...bots].sort((left, right) => lastAt(right) - lastAt(left))[0];
}

/** "+ New": say what should happen and a bot sets it up in chat, exactly as if you had asked it there. */
export function NewAutomation({ initialText = "", onClose, onSetUpYourself }: {
  initialText?: string;
  onClose: () => void;
  /** The bot this box would have asked, so the editor starts with it chosen. */
  onSetUpYourself: (kind: SetUpKind, botId: string) => void;
}) {
  const { state, dispatch } = useStore();
  const bots = state.bots.filter((bot) => !bot.hidden);
  const [text, setText] = useState(initialText);
  const [botId, setBotId] = useState(() => defaultBot(bots, state.selectedId)?.id ?? "");
  const [yourself, setYourself] = useState(false);
  const [kind, setKind] = useState<SetUpKind>("schedule");
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalDialog(dialogRef, onClose);
  const bot = bots.find((candidate) => candidate.id === botId);

  const send = () => {
    const request = text.trim();
    if (!request || !bot) return;
    // A normal chat message: the bot sets the automation up with its trigger tool and the person sees its card there.
    dispatch({ type: "select", id: bot.id });
    dispatch({ type: "send", botId: bot.id, text: request, threadId: bot.threadId });
    onClose();
  };
  const choice = (value: SetUpKind, label: string, icon: GrokIconName) => (
    <DialogChoice icon={icon} title={label} checked={kind === value} onSelect={() => setKind(value)} />
  );

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[14vh]">
      <div aria-hidden="true" className="ui-dialog-scrim absolute inset-0" onMouseDown={onClose} />
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={t("automations.newBox.title")} tabIndex={-1} style={{ maxWidth: "min(440px, calc(100vw - 32px))" }} className={formSheetCls}>
        <header className={formHeaderCls}>
          <h2 className={formTitleCls}>{yourself ? t("automations.newBox.when") : t("automations.newBox.title")}</h2>
          <button type="button" onClick={onClose} aria-label={t("automations.newBox.cancel")} className={formCloseCls}><GrokIcon name="close" size={16} /></button>
        </header>
        {yourself ? (
          <>
            <div className={cn(formBodyCls, "pb-0")}>
              <div role="radiogroup" aria-label={t("automations.newBox.when")} className={cn(listCardCls, "py-1")}>
                {choice("schedule", t("automations.newBox.onSchedule"), "clock")}
                {choice("app", t("automations.newBox.whenAppEvent"), "grid")}
                {choice("webhook", t("automations.newBox.whenApp"), "link")}
              </div>
            </div>
            <div className={cn(formFooterCls, "justify-between")}>
              <button type="button" onClick={() => setYourself(false)} className={mdSecondaryCls}>{t("automations.newBox.back")}</button>
              <button type="button" onClick={() => onSetUpYourself(kind, bot?.id ?? "")} className={mdPrimaryCls}>{t("automations.newBox.continue")}</button>
            </div>
          </>
        ) : (
          <>
            <div className={cn(formBodyCls, "flex flex-col gap-3 pb-0")}>
              <textarea autoFocus value={text} onChange={(event) => setText(event.target.value)} rows={3} aria-label={t("automations.newBox.title")} placeholder={t("automations.newBox.placeholder")}
                onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !imeComposing(event.nativeEvent)) { event.preventDefault(); send(); } }}
                className={textAreaCls} />
              {bots.length === 0 && <p className="m-0 text-[12px] leading-4 text-warning">{t("automations.newBox.noBots")}</p>}
              {bots.length > 1 && (
                <label className="flex items-center gap-2 text-[13px] leading-[18px] text-ink/68">
                  {t("automations.newBox.bot")}
                  <Select size="sm" value={botId} onChange={(event) => setBotId(event.target.value)} aria-label={t("automations.newBox.bot")} className="max-w-[220px]">
                    {bots.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
                  </Select>
                </label>
              )}
            </div>
            <div className={cn(formFooterCls, "justify-between")}>
              <button type="button" onClick={() => setYourself(true)} className="-ml-1 h-6 rounded-[6px] px-1 text-[13px] leading-[18px] text-ink/68 transition-[background-color,color] duration-[120ms] ease-[ease] hover:bg-ink/6 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus">{t("automations.newBox.yourself")}</button>
              <button type="button" disabled={!text.trim() || !bot} onClick={send} className={mdPrimaryCls}>{t("automations.newBox.send")}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
