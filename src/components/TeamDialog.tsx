import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Plus, X } from "lucide-react";
import { api, useStore, type Bot } from "@/state/store";
import { BotPickerList } from "./BotPickerList";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { fieldLabelCls, formBodyCls, formCloseCls, formFooterCls, formHeaderCls, formSheetCls, formTitleCls, mdPrimaryCls, mdSecondaryCls, rowHintCls, smallButtonCls, textFieldCls } from "./ui/GrokDialog";

export function TeamDialog({ section, rename = false, onClose, onRenamed }: {
  section?: string;
  rename?: boolean;
  onRenamed?: (oldName: string, newName: string) => void;
  onClose: () => void;
}) {
  const { state, dispatch } = useStore();
  const [name, setName] = useState(section ?? "");
  const managing = Boolean(section) && !rename;
  const initialMembers = useRef(new Set(managing ? state.bots.filter(bot => !bot.hidden && (bot.section?.trim() ?? "") === section).map(bot => bot.id) : []));
  const [picked, setPicked] = useState<Set<string>>(() => new Set(initialMembers.current));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const dialog = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    (dialog.current?.querySelector<HTMLElement>("input") ?? dialog.current?.querySelector<HTMLElement>("button"))?.focus();
    return () => { if (opener?.isConnected) opener.focus(); };
  }, []);
  const moving = section !== undefined && !rename;
  const title = rename ? t("team.rename") : managing ? t(initialMembers.current.size ? "team.manageBots" : "team.addBots") : moving ? t("team.moveTo", { name: section || "General" }) : t("team.create");
  const candidates = state.bots.filter((bot) => !bot.hidden && (managing || !moving || (bot.section?.trim() ?? "") !== section));
  const addBotIds = [...picked].filter(id => !initialMembers.current.has(id));
  const removeBotIds = [...initialMembers.current].filter(id => !picked.has(id));
  const unchanged = managing ? !addBotIds.length && !removeBotIds.length : moving && !picked.size;
  const save = async () => {
    if (saving || (!moving && !name.trim()) || unchanged) return;
    if (section === undefined && [...(state.sections ?? []), ...state.bots.map((bot) => bot.section), ...state.groups.map((group) => group.section)].includes(name.trim())) {
      setError(t("team.duplicate"));
      return;
    }
    setSaving(true);
    setError("");
    try {
      const result: { sections: string[]; bots?: Bot[] } = await api(
        rename || managing ? `/api/sidebar-sections?section=${encodeURIComponent(section!)}` : "/api/sidebar-sections",
        { method: rename ? "PATCH" : managing ? "PUT" : "POST", body: JSON.stringify(rename ? { name: name.trim() } : managing ? { addBotIds, removeBotIds } : { name: name.trim(), botIds: [...picked] }) },
      );
      dispatch({ type: "sections", sections: result.sections });
      for (const bot of result.bots ?? []) dispatch({ type: "botPatched", bot });
      if (rename && section !== undefined) onRenamed?.(section, name.trim());
      onCloseRef.current();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setSaving(false);
    }
  };
  const createBot = () => {
    setError("");
    dispatch({ type: "newBot", section, preserveSelection: true, onError: setError, onCreated: (bot) => {
      initialMembers.current.add(bot.id);
      setPicked(previous => new Set([...previous, bot.id]));
    } });
  };
  return createPortal(
    <div className="ui-dialog-scrim fixed inset-0 z-50 flex items-center justify-center p-4" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !saving) onClose();
    }}>
      <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="team-dialog-title"
        className={cn(formSheetCls, "max-w-[440px]", "focus-visible:outline-none!")}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !saving) { event.stopPropagation(); onClose(); }
          if (event.key === "Tab") {
            const controls = dialog.current?.querySelectorAll<HTMLElement>("input:enabled, button:enabled");
            if (!controls?.length) return;
            const first = controls[0], last = controls[controls.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
          }
        }}>
        <header className={formHeaderCls}>
          <h2 id="team-dialog-title" className={formTitleCls}>{title}</h2>
          <button aria-label={t("team.closeDialog")} disabled={saving} onClick={onClose} className={formCloseCls}><X size={16} /></button>
        </header>
        <div className={cn(formBodyCls, "flex flex-col gap-3")}>
        {(!moving || rename) && <label className="flex flex-col gap-1"><span className={fieldLabelCls}>{t("team.name")}</span>
          <input value={name} maxLength={60} disabled={saving} onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") void save(); }}
            className={textFieldCls} />
        </label>}
        {!rename && <>
          <p className={cn(rowHintCls, "m-0 text-pretty")}>
            {managing ? t("team.manageIntro") : moving ? t("team.moveIntro") : t("team.createIntro")} {t("team.moveWarning")}
          </p>
          {managing && <button disabled={saving || state.botCreationPending} onClick={createBot}
            className={cn(smallButtonCls, "self-start")}>
            <Plus size={12} />{t("sidebar.newBot")}
          </button>}
          <fieldset disabled={saving} className="m-0 min-w-0 border-0 p-0">
            <legend className={cn(fieldLabelCls, "mb-1")}>{t("team.existingBots")}</legend>
            <BotPickerList bots={candidates} picked={picked} emptyHint={t("team.noBots")} onToggle={(id) => setPicked((previous) => {
              const next = new Set(previous);
              if (next.has(id)) next.delete(id); else next.add(id);
              return next;
            })} />
          </fieldset>
        </>}
        {error && <p role="alert" className="m-0 text-[12px] leading-4 text-danger">{error}</p>}
        </div>
        <div className={formFooterCls}>
          <button disabled={saving} onClick={onClose} className={mdSecondaryCls}>{t("common.cancel")}</button>
          <button disabled={saving || (!moving && !name.trim()) || unchanged} onClick={() => void save()}
            className={mdPrimaryCls}>
            {saving ? t("team.saving") : rename ? t("folder.saveName") : managing ? t("common.save") : moving ? picked.size ? t(picked.size === 1 ? "team.moveOne" : "team.moveMany", { count: picked.size }) : t("team.moveSelected") : t("team.create")}
          </button>
        </div>
      </div>
    </div>, document.body,
  );
}
