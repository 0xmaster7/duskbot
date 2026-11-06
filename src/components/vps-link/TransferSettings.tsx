// Settings > Transfer: where the bots live now, moving them back to this computer, and the backups a move keeps
import { useEffect, useRef, useState } from "react";
import { t } from "@/lib/i18n";
import { formatBytes, openAddVps, vpsLinkBridge, type VpsBackup, type VpsWhere } from "@/lib/vps-link";
import { Card, ItemRow, NavRow, NoteRow } from "../ListRows";
import { smallButtonCls } from "../ui/GrokDialog";
import { deviceWord, message } from "./parts";

const confirmAction = (text: string) => (window.ogb?.confirm ? window.ogb.confirm(text) : Promise.resolve(window.confirm(text)));

function backupWhen(at: number): string {
  return new Date(at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function backupContents(backup: VpsBackup): string {
  const size = formatBytes(backup.bytes);
  if (!backup.summary) return size;
  return t("vpsLink.transfer.contents", { bots: backup.summary.bots, chats: backup.summary.chats, skills: backup.summary.skills, routines: backup.summary.routines, size });
}

export function TransferSettings() {
  const bridge = vpsLinkBridge();
  const [where, setWhere] = useState<VpsWhere | null>(null);
  const [backups, setBackups] = useState<VpsBackup[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const alive = useRef(true);
  const device = deviceWord();

  const load = () => {
    if (!bridge) return;
    void Promise.all([bridge.where(), bridge.backups()]).then(([place, list]) => {
      if (!alive.current) return;
      setWhere(place); setBackups(list);
    }, (cause) => { if (alive.current) setError(message(cause)); });
  };
  useEffect(() => {
    alive.current = true;
    load();
    const unsubscribe = bridge?.onChange(() => load());
    return () => { alive.current = false; unsubscribe?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge]);

  if (!bridge) return <Card><NoteRow>{t("vpsLink.transfer.desktopOnly")}</NoteRow></Card>;
  const perform = async (ask: string | null, work: () => Promise<unknown>, done?: string) => {
    if (busy || (ask && !await confirmAction(ask))) return;
    setBusy(true); setError(""); setNote("");
    try {
      await work();
      if (alive.current && done) setNote(done);
    } catch (cause) { if (alive.current) setError(message(cause)); }
    finally { if (alive.current) { setBusy(false); load(); } }
  };
  const server = where?.place === "vps" ? where.server : null;
  return (
    <>
      <Card label={t("vpsLink.transfer.whereTitle")} data-settings-block="transfer">
        {!where
          ? <NoteRow>{error || t("vpsLink.transfer.loading")}</NoteRow>
          : <ItemRow title={server ? server.name : t("vpsLink.transfer.thisDevice", { device })}
              hint={server ? t("vpsLink.transfer.onServer") : t("vpsLink.transfer.onDevice", { device })} />}
        {where && (server
          ? <>
              <NavRow title={t("vpsLink.transfer.moveBack", { device })} hint={t("vpsLink.transfer.moveBackHint", { name: server.name, device })} disabled={busy}
                onClick={() => void perform(t("vpsLink.transfer.moveBackConfirm", { name: server.name, device }), () => bridge.moveBack(), t("vpsLink.transfer.moveBackStarted"))} />
              <NavRow title={t("vpsLink.transfer.forget", { name: server.name })} hint={t("vpsLink.transfer.forgetHint")} danger drill={false} disabled={busy}
                onClick={() => void perform(t("vpsLink.transfer.forgetConfirm", { name: server.name }), () => bridge.forget())} />
            </>
          : <NavRow title={t("vpsLink.add")} hint={t("vpsLink.addHint")} onClick={openAddVps} />)}
      </Card>
      <Card label={t("vpsLink.transfer.backupsTitle")} footnote={t("vpsLink.transfer.backupsNote", { device })}>
        {backups === null
          ? <NoteRow>{t("vpsLink.transfer.loading")}</NoteRow>
          : backups.length === 0
            ? <NoteRow>{t("vpsLink.transfer.noBackups")}</NoteRow>
            : backups.map((backup) => (
              <ItemRow key={backup.id} title={backupWhen(backup.at)} hint={`${t(`vpsLink.transfer.reason.${backup.reason}`)} · ${backupContents(backup)}`}>
                <button type="button" className={smallButtonCls} disabled={busy} aria-label={t("vpsLink.transfer.restoreAria", { when: backupWhen(backup.at) })}
                  onClick={() => void perform(t("vpsLink.transfer.restoreConfirm", { when: backupWhen(backup.at) }), () => bridge.restore(backup.id))}>
                  {t("vpsLink.transfer.restore")}
                </button>
              </ItemRow>
            ))}
        <NavRow title={t("vpsLink.transfer.backupNow")} hint={t("vpsLink.transfer.backupNowHint", { device })} drill={false} disabled={busy}
          onClick={() => void perform(null, () => bridge.backupNow(), t("vpsLink.transfer.backedUp"))} />
        {note && <NoteRow>{note}</NoteRow>}
        {error && where && <NoteRow tone="danger">{error}</NoteRow>}
      </Card>
    </>
  );
}
