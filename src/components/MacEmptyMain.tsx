// This computer's own app while it has no bots and the person's live somewhere else, once they chose to be here: what is
// missing and the two ways on, a new bot here, or their bots back from that place (or opening it, when they can't come).
import { useEffect, useRef, useState } from "react";
import { Plus } from "../icons";
import type { ElsewherePlace } from "@/lib/bots-elsewhere";
import { t } from "@/lib/i18n";
import { vpsLinkBridge, type VpsWhere } from "@/lib/vps-link";
import { MausAvatar } from "./Avatar";
import { openCreateBot } from "./CreateBotDialog";
import { WindowDragStrip } from "./DesktopCapabilities";
import { rowButtonCls } from "./ui/GrokDialog";
import { deviceWord, message } from "./vps-link/parts";

const confirmAction = (text: string) => (window.duskDesktop?.confirm ? window.duskDesktop.confirm(text) : Promise.resolve(window.confirm(text)));

/** Whether this empty state stands in for the chat: until the person opens a bot or a room themselves (a new selection,
 * or a click on a sidebar row, the one already selected included). */
export function useMacEmptyShown(from: ElsewherePlace | null, selectedId: string): boolean {
  const [left, setLeft] = useState(false);
  const first = useRef<string | null>(null);
  useEffect(() => {
    if (!from) return;
    if (first.current === null) { first.current = selectedId; return; }
    if (selectedId !== first.current) setLeft(true);
  }, [from, selectedId]);
  useEffect(() => {
    if (!from || left) return;
    const picked = (event: Event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("[data-sidebar-bot-row], [data-sidebar-group-row]")) setLeft(true);
    };
    const key = (event: KeyboardEvent) => { if (event.key === "Enter" || event.key === " ") picked(event); };
    document.addEventListener("click", picked, true);
    document.addEventListener("keydown", key, true);
    return () => { document.removeEventListener("click", picked, true); document.removeEventListener("keydown", key, true); };
  }, [from, left]);
  return Boolean(from) && !left;
}

export function MacEmptyMain({ from }: { from: ElsewherePlace }) {
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
  return (
    <main data-mac-empty={from.id} className="relative flex h-full min-w-0 flex-1 flex-col items-center justify-center gap-3 bg-app px-4 text-center">
      <WindowDragStrip />
      <div aria-hidden="true"><MausAvatar color="chrome" size={56} state="idle" /></div>
      <div className="flex max-w-[380px] flex-col gap-1">
        <h1 className="text-[14px] font-medium leading-5 text-ink">{t("macEmpty.title", { device })}</h1>
        <p className="text-[13px] leading-[18px] tracking-[0.015em] text-ink/[0.56] text-pretty">
          {t(back ? "macEmpty.body" : "macEmpty.bodyOpen", { name, device })}
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <button type="button" data-mac-empty-create="" className={rowButtonCls} onClick={() => openCreateBot()}>
          <Plus size={14} aria-hidden="true" />
          {t("macEmpty.create")}
        </button>
        {back
          ? <button type="button" data-mac-empty-back="" className={rowButtonCls} disabled={busy || Boolean(note)} onClick={() => void bringBack()}>{t("macEmpty.bringBack", { name })}</button>
          : <button type="button" data-mac-empty-open="" className={rowButtonCls} disabled={busy} onClick={openThere}>{t("macEmpty.open", { name })}</button>}
      </div>
      {note && <p role="status" className="max-w-[380px] text-[13px] leading-[18px] text-ink-secondary">{note}</p>}
      {error && <p role="alert" className="max-w-[380px] text-[13px] leading-[18px] text-danger [overflow-wrap:anywhere]">{error}</p>}
    </main>
  );
}
