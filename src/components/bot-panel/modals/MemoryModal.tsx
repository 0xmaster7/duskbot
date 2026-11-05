import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { Bot } from "@/state/store";
import { GrokIcon } from "../../GrokIcon";
import type { useBotSettingsDerived } from "../../bot-settings/useBotSettingsDerived";
import { BotSwitch } from "../rows";
import { kitPrimaryCls, kitSecondaryCls, ListGroup, listRowCls, ModalSheet, RowIconButton, rowHintCls, rowTitleCls } from "./ModalSheet";
import { useMemoryEditor } from "./use-memory-editor";

/** What the bot remembers: memory on or off, its notes with a forget on each, and a line to add one. */
export function MemoryModal({ bot, derived, onClose }: {
  bot: Bot;
  derived: ReturnType<typeof useBotSettingsDerived>;
  onClose: () => void;
}) {
  const { memoryOn, readError, notes, index, draft, setDraft, saving, error, forget, add } = useMemoryEditor(bot);
  const count = notes?.length ?? 0;
  const label = notes === null || count === 0 ? "Notes" : count === 1 ? t("botPanel.memory.note") : t("botPanel.memory.notes", { count });

  return (
    <ModalSheet
      data-panel-modal="memory"
      width={480}
      title={t("botPanel.memoryRow")}
      onClose={onClose}
      footer={<button type="button" onClick={onClose} className={kitPrimaryCls}><span>{t("common.done")}</span></button>}
    >
      <div className="flex flex-col gap-5">
        <ListGroup>
          <div data-modal-row="memory-on" className={listRowCls}>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className={rowTitleCls}>{t("memory.enable")}</span>
              <span className={rowHintCls}>{memoryOn ? `${bot.name} saves what matters and keeps it tidy.` : t("botPanel.library.memoryOff", { name: bot.name })}</span>
            </div>
            <BotSwitch
              color={bot.color}
              checked={memoryOn}
              disabled={Boolean(bot.busy) || bot.yourAccess === "view"}
              aria-label={t("memory.enable")}
              onClick={() => derived.patch({ memoryEnabled: !memoryOn })}
            />
          </div>
        </ListGroup>

        {memoryOn && (
          <ListGroup label={label} data-modal-group="notes">
            {readError ? (
              <p className={cn(listRowCls, rowHintCls, "text-warning")}>{t("botPanel.library.memoryError")}</p>
            ) : notes === null ? (
              <div aria-busy="true" className="flex flex-col gap-2 px-3.5 py-3">
                <span className="h-3.5 w-3/4 rounded-full bg-ink/6" />
                <span className="h-3.5 w-1/2 rounded-full bg-ink/6" />
              </div>
            ) : notes.length === 0 ? (
              <div data-modal-empty className="flex flex-col items-center gap-1.5 px-6 py-6 text-center">
                <span aria-hidden="true" className="flex text-ink/40"><GrokIcon name="brain" size={20} /></span>
                <span className={rowTitleCls}>{t("botPanel.memory.empty")}</span>
                <span className={cn(rowHintCls, "text-pretty")}>Add a note below, or {bot.name} picks things up as you talk.</span>
              </div>
            ) : (
              <ul aria-label={label} className="m-0 flex max-h-[min(320px,calc(100dvh-380px))] list-none flex-col overflow-y-auto p-0 [scrollbar-width:thin]">
                {notes.map((note) => (
                  <li key={`${note.path}:${note.line}:${note.text}`} data-memory-note={note.line ?? note.path} className={cn("group/row", listRowCls, "min-h-11 py-2 hover:bg-ink/[0.03]")}>
                    <span className={cn(rowTitleCls, "min-w-0 flex-1 text-pretty")}>{note.text}</span>
                    <RowIconButton reveal icon="trash" data-modal-action="forget" label={t("botPanel.memory.forget")} disabled={saving} onClick={() => forget(note)} />
                  </li>
                ))}
              </ul>
            )}
            <form
              data-panel-form="memory-add"
              className="mx-2 mt-1 flex items-center gap-2 border-t border-ink/[0.08] pl-1.5 pt-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (draft.trim() && !saving) void add();
              }}
            >
              <input
                value={draft}
                placeholder={t("botPanel.memory.addPlaceholder", { name: bot.name })}
                aria-label={t("botPanel.memory.addPlaceholder", { name: bot.name })}
                disabled={saving || index === null}
                onChange={(event) => setDraft(event.target.value)}
                className="h-8 min-w-0 flex-1 rounded-[6px] bg-transparent px-1 text-[13px] leading-[18px] tracking-[-0.08px] text-ink outline-none placeholder:text-ink/56 focus-visible:shadow-[0_0_0_2px_var(--color-focus)] disabled:opacity-50"
              />
              <button type="submit" disabled={saving || index === null || !draft.trim()} className={kitSecondaryCls}><span>{t("common.add")}</span></button>
            </form>
          </ListGroup>
        )}
        {error && <p role="alert" className={cn(rowHintCls, "px-3.5 text-warning")}>{error}</p>}
      </div>
    </ModalSheet>
  );
}
