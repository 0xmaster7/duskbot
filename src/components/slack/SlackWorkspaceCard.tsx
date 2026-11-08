import { useState } from "react";
import { t } from "@/lib/i18n";
import { SLACK_APPS_URL } from "../../../shared/slack.ts";
import { Card, FormField, ItemRow, NoteRow, pillCls, pillPrimaryCls, rowCls } from "../ListRows";
import { textFieldCls } from "../ui/GrokDialog";
import { useSlackWorkspace } from "./use-slack";

export function SlackWorkspaceCard() {
  const { status, available, error, busy, connect, disconnect } = useSlackWorkspace();
  const [open, setOpen] = useState(false);
  const [access, setAccess] = useState("");
  const [refresh, setRefresh] = useState("");
  const clear = () => { setOpen(false); setAccess(""); setRefresh(""); };
  if (!available) return null;
  return (
    <Card label={t("slack.title")}>
      {!status || !status.ready ? <NoteRow>{t("slack.loading")}</NoteRow> : <>
        {status.state === "connected" ? <>
          <ItemRow title={t("slack.workspace.connected", { team: status.teamName ?? status.teamId ?? "" })} value={status.apps ? t("slack.workspace.bots", { count: status.apps }) : t("slack.workspace.none")}>
            <button type="button" className={pillCls} disabled={busy} onClick={() => void disconnect()}>{t("slack.disconnect")}</button>
          </ItemRow>
          <NoteRow>{t("slack.workspace.addHint")}</NoteRow>
        </> : status.state === "needs_reconnect" ? (
          <ItemRow title={t("slack.workspace.reconnectHint")} tone="warn">
            {!open && <button type="button" className={pillCls} onClick={() => setOpen(true)}>{t("slack.reconnect")}</button>}
          </ItemRow>
        ) : (
          <ItemRow title={t("slack.workspace.title")} hint={t("slack.workspace.hint")}>
            {!open && <button type="button" className={pillCls} onClick={() => setOpen(true)}>{t("slack.connect")}</button>}
          </ItemRow>
        )}
        {open && <form onSubmit={(event) => { event.preventDefault(); if (!busy && access.trim() && refresh.trim()) void connect(access, refresh).then((ok) => { if (ok) clear(); }); }}>
          <NoteRow><a href={SLACK_APPS_URL} target="_blank" rel="noopener noreferrer">{t("slack.workspace.step1")}</a></NoteRow>
          <NoteRow>{t("slack.workspace.step2")}</NoteRow>
          <NoteRow>{t("slack.workspace.step3")}</NoteRow>
          <div className={rowCls}><div className="min-w-0 flex-1"><FormField label={t("slack.workspace.access")}>
            <input type="password" aria-label={t("slack.workspace.access")} placeholder={t("slack.workspace.accessPlaceholder")} autoComplete="off" spellCheck={false} dir="ltr" className={textFieldCls} value={access} onChange={(event) => setAccess(event.target.value)} />
          </FormField></div></div>
          <div className={rowCls}><div className="min-w-0 flex-1"><FormField label={t("slack.workspace.refresh")}>
            <input type="password" aria-label={t("slack.workspace.refresh")} placeholder={t("slack.workspace.refreshPlaceholder")} autoComplete="off" spellCheck={false} dir="ltr" className={textFieldCls} value={refresh} onChange={(event) => setRefresh(event.target.value)} />
          </FormField></div></div>
          <NoteRow>{t("slack.workspace.limit")}</NoteRow>
          <div className={rowCls}>
            <button type="submit" className={pillPrimaryCls} disabled={busy || !access.trim() || !refresh.trim()}>{t("slack.connect")}</button>
            <button type="button" className={pillCls} disabled={busy} onClick={clear}>{t("slack.cancel")}</button>
          </div>
        </form>}
      </>}
      {error && <NoteRow tone="danger">{error}</NoteRow>}
    </Card>
  );
}
