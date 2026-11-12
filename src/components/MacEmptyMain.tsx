// This computer's own app while it has no bots and the person's live somewhere else: a dialog over the normal chat, once
// per place, saying what is missing and the two ways on, a new bot here, or their bots back from that place (or opening
// it, when they can't come).
import { useCallback, useState, useSyncExternalStore, useEffect } from "react";
import { Plus } from "../icons";
import type { ElsewherePlace } from "@/lib/bots-elsewhere";
import { t } from "@/lib/i18n";
import { vpsLinkBridge, type VpsWhere } from "@/lib/vps-link";
import { openCreateBot } from "./CreateBotDialog";
import { GrokDialog, mdPrimaryCls, mdSecondaryCls, rowHintCls } from "./ui/GrokDialog";
import { deviceWord, message } from "./vps-link/parts";

const confirmAction = (text: string) => (window.duskDesktop?.confirm ? window.duskDesktop.confirm(text) : Promise.resolve(window.confirm(text)));

const SEEN = "dusk-mac-empty-seen";
const watchers = new Set<() => void>();
function seenPlaces(): string {
  try { return localStorage.getItem(SEEN) ?? "[]"; } catch { return "[]"; }
}
function markSeen(id: string): void {
  try {
    const list = (JSON.parse(seenPlaces()) as unknown[]).filter((entry): entry is string => typeof entry === "string" && entry !== id);
    localStorage.setItem(SEEN, JSON.stringify([...list, id].slice(-20)));
  } catch { /* storage full or off */ }
  for (const watch of watchers) watch();
}

/** Whether the dialog for this place is up: once per place, until the person closes it or takes one of its ways on. */
export function useMacEmptyPrompt(from: ElsewherePlace | null): [boolean, () => void] {
  const seen = useSyncExternalStore((watch) => { watchers.add(watch); return () => { watchers.delete(watch); }; }, seenPlaces, () => "[]");
  const id = from?.id ?? null;
  const shown = id !== null && !(JSON.parse(seen) as unknown[]).includes(id);
  const dismiss = useCallback(() => { if (id) markSeen(id); }, [id]);
  return [shown, dismiss];
}

export function MacEmptyMain({ from, onClose }: { from: ElsewherePlace; onClose: () => void }) {
  const device = deviceWord();
  const link = vpsLinkBridge();
  const [where, setWhere] = useState<VpsWhere | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    void link?.where().then((place) => { if (alive) setWhere(place); }, () => {});
    return () => { alive = false; };
  }, [link]);
  // the bots come back only from the server this computer moved them to; anywhere else they can be opened where they are
  const back = Boolean(link && where?.place === "vps" && where.server);
  const name = back ? where!.server!.name : from.name;
  const bringBack = async () => {
    if (busy || !link || !await confirmAction(t("macEmpty.bringBackConfirm", { name, device }))) return;
    setBusy(true); setError("");
    try { await link.moveBack(); setNote(t("macEmpty.bringing")); } catch (cause) { setError(message(cause)); } finally { setBusy(false); }
  };
  const openThere = () => {
    if (busy) return;
    const go = window.duskDesktop?.elsewhere?.open(from.id);
    if (!go) return;
    setBusy(true); setError("");
    void go.then((opened) => { if (opened === false) setError(t("macEmpty.failed", { name })); }, () => setError(t("macEmpty.failed", { name }))).finally(() => setBusy(false));
  };
  const create = () => { onClose(); openCreateBot(); };
  const actionCls = "max-w-full min-w-0";
  return (
    <GrokDialog
      data-mac-empty={from.id}
      width={560}
      title={t("macEmpty.title", { device })}
      description={t(back ? "macEmpty.body" : "macEmpty.bodyOpen", { name, device })}
      onClose={onClose}
      footer={
        <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
          <button type="button" data-mac-empty-later="" className={mdSecondaryCls} onClick={onClose}>{t("macEmpty.notNow")}</button>
          <button type="button" data-mac-empty-create="" className={mdSecondaryCls} onClick={create}>
            <Plus size={14} aria-hidden="true" />
            {t("macEmpty.create")}
          </button>
          {back
            ? <button type="button" data-mac-empty-back="" data-autofocus="" className={`${mdPrimaryCls} ${actionCls}`} disabled={busy || Boolean(note)} onClick={() => void bringBack()}><span className="truncate">{t("macEmpty.bringBack", { name })}</span></button>
            : <button type="button" data-mac-empty-open="" data-autofocus="" className={`${mdPrimaryCls} ${actionCls}`} disabled={busy} onClick={openThere}><span className="truncate">{t("macEmpty.open", { name })}</span></button>}
        </div>
      }
    >
      {note && <p role="status" className={`${rowHintCls} m-0`}>{note}</p>}
      {error && <p role="alert" className="m-0 text-[13px] leading-[18px] text-danger [overflow-wrap:anywhere]">{error}</p>}
    </GrokDialog>
  );
}
