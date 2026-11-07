import { useCallback, useEffect, useState } from "react";

import { api } from "@/state/store";
import { t } from "@/lib/i18n";
import type { EmailConnectAnswer, EmailServerFields, EmailStatus } from "../../shared/email";
import { KitActions, KitBody, KitButton, KitCard, KitField, KitLink, KitRow, KitStatus, KitText } from "./connect-apps/detail-kit";

const field = "h-8 w-full min-w-0 rounded-lg bg-inset px-2.5 text-[13px] text-ink placeholder:text-ink-secondary focus:outline-none focus:ring-1 focus:ring-focus";

/** Where a mail server is, for when it can't be found from the address. */
export function EmailServerInputs({ value, onChange, className = field }: { value: EmailServerFields; onChange: (next: EmailServerFields) => void; className?: string }) {
  const text = (name: "imapHost" | "smtpHost" | "username", label: string) => (
    <input type="text" autoComplete="off" spellCheck={false} dir="ltr" aria-label={label} placeholder={label} value={value[name] ?? ""} onChange={(event) => onChange({ ...value, [name]: event.target.value })} className={className} />
  );
  const port = (name: "imapPort" | "smtpPort", label: string) => (
    <input type="number" min={1} max={65535} autoComplete="off" dir="ltr" aria-label={label} placeholder={label} value={value[name] ?? ""} onChange={(event) => { const { [name]: _gone, ...rest } = value; onChange(event.target.value ? { ...rest, [name]: Number(event.target.value) } : rest); }} className={className} />
  );
  return (
    <div data-email-server-fields className="grid grid-cols-[minmax(0,1fr)_6rem] gap-2">
      {text("imapHost", t("email.incomingServer"))}{port("imapPort", t("email.port"))}
      {text("smtpHost", t("email.outgoingServer"))}{port("smtpPort", t("email.port"))}
      <div className="col-span-2">{text("username", t("email.username"))}</div>
    </div>
  );
}

/** Email on its Connect Apps page: any mailbox on any mail host, connected with an address and a password. */
export function EmailCard({ refreshKey = 0, onConnection }: {
  refreshKey?: number;
  /** true once connected, false otherwise, null until the server has answered */
  onConnection?: (connected: boolean | null) => void;
}) {
  const [status, setStatus] = useState<EmailStatus | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [address, setAddress] = useState("");
  const [password, setPassword] = useState("");
  const [server, setServer] = useState<EmailServerFields>({});
  const [needsServer, setNeedsServer] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const answer = await api("/api/email") as EmailStatus;
      setStatus(answer);
      setLoadFailed(false);
    } catch { setLoadFailed(true); }
  }, []);
  useEffect(() => { void load(); }, [load, refreshKey]);
  useEffect(() => { onConnection?.(status ? status.state === "connected" : null); }, [status, onConnection]);

  const connect = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const answer = await api("/api/email/accounts", { method: "POST", body: JSON.stringify({ address: address.trim(), password, ...server }) }) as EmailConnectAnswer;
      if (!answer.ok) {
        setError(answer.error);
        if (answer.needsServer) setNeedsServer(true);
        return;
      }
      setPassword("");
      setOpen(false);
      setNeedsServer(false);
      setServer({});
      setAddress("");
      setDone(answer.sending.ok ? t("email.connected", { count: answer.inbox.messages }) : t("email.connectedNoSending", { count: answer.inbox.messages }));
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setBusy(false); }
  };

  const disconnect = async (mailbox: string) => {
    setDone(null);
    try { setStatus(await api(`/api/email/accounts/${encodeURIComponent(mailbox)}`, { method: "DELETE" }) as EmailStatus); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };

  if (status?.state === "unavailable") return null;
  const accounts = status?.accounts ?? [];
  const connected = accounts.length > 0;

  return (
    <KitBody data-app-tile="email" data-email-state={status?.state ?? "loading"}>
      {status === null && (loadFailed
        ? <KitActions><KitButton variant="secondary" onClick={() => void load()}>{t("connectors.action.retry")}</KitButton></KitActions>
        : <KitStatus>{t("common.checking")}</KitStatus>)}
      {status !== null && !open && <KitText>{t("email.help")}</KitText>}
      {connected && (
        <div className="ca-kit-card">
          <KitCard label={t("connectApps.accounts")} count={accounts.length}>
            {accounts.map((account) => (
              <KitRow key={account.address} title={account.address} detail={account.problem}>
                <button type="button" className="ca-link" data-tone="danger" aria-label={t("email.disconnect", { address: account.address })} onClick={() => void disconnect(account.address)}>
                  {t("connectors.disconnect")}
                </button>
              </KitRow>
            ))}
          </KitCard>
        </div>
      )}
      {done && <KitStatus tone="ok">{done}</KitStatus>}
      {error && <KitStatus tone="danger">{error}</KitStatus>}
      {status !== null && !open && (
        <KitActions>
          <KitButton variant={connected ? "secondary" : "primary"} onClick={() => { setOpen(true); setError(null); }}>
            {connected ? t("email.addAnother") : t("connectors.action.connect")}
          </KitButton>
        </KitActions>
      )}
      {open && (
        <form data-email-form className="ca-kit" style={{ alignSelf: "stretch" }} onSubmit={(event) => { event.preventDefault(); void connect(); }}>
          <KitText>{t("email.help")}</KitText>
          <KitField label={t("email.address")} type="email" autoComplete="off" spellCheck={false} dir="ltr" value={address} onChange={(event) => setAddress(event.target.value)} />
          <KitField label={t("email.password")} type="password" autoComplete="new-password" spellCheck={false} dir="ltr" value={password} onChange={(event) => setPassword(event.target.value)} />
          {needsServer && <EmailServerInputs value={server} onChange={setServer} className="ca-kit-input" />}
          <KitActions>
            <KitButton type="submit" disabled={busy || !address.trim() || !password}>{busy ? t("connectApps.connecting") : t("connectors.action.connect")}</KitButton>
            <KitButton variant="secondary" disabled={busy} onClick={() => { setOpen(false); setError(null); }}>{t("common.cancel")}</KitButton>
          </KitActions>
          {busy && <KitStatus>{t("email.checking")}</KitStatus>}
          {!needsServer && !busy && <KitLink onClick={() => setNeedsServer(true)}>{t("email.typeServer")}</KitLink>}
        </form>
      )}
    </KitBody>
  );
}
