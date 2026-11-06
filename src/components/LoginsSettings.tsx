import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Loader2 } from "lucide-react";

import type { LoginBots, LoginSummary, OnePasswordStatus, OnePasswordVault } from "../../shared/logins";
import { t } from "@/lib/i18n";
import { addLogin, changeLogin, connectOnePassword, deleteLogin, disconnectOnePassword, grantVault, listLogins, refreshOnePassword } from "@/lib/logins";
import { relativeTime } from "@/lib/memory";
import { useOwnerOrAdmin } from "@/lib/use-owner-or-admin";
import { useStore } from "@/state/store";
import { LoginBotPicker, LoginForm } from "./LoginForm";
import { ItemRow, NavRow, NoteRow } from "./ListRows";
import { Card, SettingsGroup, SettingsRows } from "./SettingsPrimitives";
import { DialogPane, GrokDialog, mdPrimaryCls, mdSecondaryCls, textFieldCls } from "./ui/GrokDialog";
import { cn } from "@/lib/cn";

// Security: a row never shows the password, which no route returns.

const SOURCE_KEYS = {
  card: "settings.logins.source.card",
  settings: "settings.logins.source.settings",
  "1password": "settings.logins.source.1password",
} as const;


export function LoginsSettings() {
  const { state } = useStore();
  const ownerOrAdmin = useOwnerOrAdmin();
  const bots = state.bots.map((bot) => ({ id: bot.id, name: bot.name }));
  const [logins, setLogins] = useState<LoginSummary[] | null>(null);
  const [onePassword, setOnePassword] = useState<OnePasswordStatus>({ connected: false });
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [site, setSite] = useState("");
  const [addBots, setAddBots] = useState<LoginBots>("all");
  const [addExact, setAddExact] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [editBots, setEditBots] = useState<LoginBots>("all");
  const [editExact, setEditExact] = useState(false);
  const [removeTotp, setRemoveTotp] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const answer = await listLogins();
      setLogins(answer.logins);
      setOnePassword(answer.onePassword ?? { connected: false });
      setError(null);
    }
    catch (cause) { setError(cause instanceof Error && cause.message ? cause.message : t("settings.logins.loadError")); }
  };
  useEffect(() => { if (ownerOrAdmin) void load(); }, [ownerOrAdmin]);

  if (ownerOrAdmin === false) {
    return <Card subtitle={t("settings.logins.adminOnly")} />;
  }

  const botNames = (value: LoginBots) => {
    if (value === "all") return t("settings.logins.allBots");
    const names = value.flatMap((id) => bots.find((bot) => bot.id === id)?.name ?? []);
    return names.length ? names.join(", ") : t("settings.logins.noBots");
  };
  const startEdit = (login: LoginSummary) => {
    setAdding(false);
    setDeleting(null);
    setRemoveTotp(false);
    setEditBots(login.bots);
    setEditExact(login.exactHost);
    setEditing(login.id);
  };
  const remove = async (id: string) => {
    if (deleting !== id) { setDeleting(id); return; }
    setBusy(true);
    try { await deleteLogin(id); setDeleting(null); setEditing(null); await load(); }
    catch (cause) { setError(cause instanceof Error && cause.message ? cause.message : t("settings.logins.deleteError")); }
    finally { setBusy(false); }
  };

  const loginForm = (title: string, onClose: () => void, form: ReactNode) => (
    <DialogPane.Provider value={false}>
      <GrokDialog data-panel-modal="login" title={title} description={t("logins.private")} onClose={onClose}>{form}</GrokDialog>
    </DialogPane.Provider>
  );
  const editingLogin = logins?.find((login) => login.id === editing);

  return (
    <>
      <SettingsGroup label={t("settings.section.logins")} block="logins">
        {state.config?.cloudHome === true && <p className="px-3 text-[12px] leading-4 text-ink-tertiary" data-logins-cloud-own>{t("settings.logins.cloudOwn")}</p>}
        <SettingsRows>
          <div aria-busy={logins === null || busy} className="flex flex-col">
            {logins === null && !error && <NoteRow>{t("settings.logins.loading")}</NoteRow>}
            {logins?.length === 0 && <NoteRow>{t("settings.w6c.logins.empty")}</NoteRow>}
            {!!logins?.length && (
              <ul className="flex flex-col" data-logins-list>
                {logins.map((login) => {
                  const details = [login.username || t("settings.logins.noUsername"), t(SOURCE_KEYS[login.source]), botNames(login.bots),
                    login.lastUsedAt ? t("settings.logins.used", { when: relativeTime(login.lastUsedAt) }) : t("settings.logins.neverUsed")].join(" · ");
                  const hosts = signInHostsLine(login);
                  const title = <span dir="ltr">{login.site}{login.hasTotp && <span className="text-ink-secondary"> · {t("settings.logins.twoFactor")}</span>}</span>;
                  const hint = <span dir="auto">{details}{hosts && <span data-login-hosts> · {hosts}</span>}</span>;
                  return (
                    <li key={login.id} className="flex flex-col" data-login-row={login.site}>
                      {login.source === "1password"
                        ? <ItemRow title={title} hint={hint} />
                        : <NavRow title={title} hint={hint} disabled={busy} aria-label={t("settings.logins.changeFor", { site: login.site })} onClick={() => startEdit(login)} />}
                    </li>
                  );
                })}
              </ul>
            )}
            <NavRow data-settings-open="add-login" title={t("settings.logins.add")} disabled={logins === null}
              onClick={() => { setEditing(null); setDeleting(null); setAdding(true); }} />
          </div>
        </SettingsRows>
        {error && <p role="alert" className="px-3 text-[12px] leading-4 text-danger">{error}</p>}
      </SettingsGroup>
      {adding && loginForm(t("settings.logins.add"), () => setAdding(false),
        <LoginForm site={{ value: site, onChange: setSite }} compact submitLabel={t("settings.logins.save")} autoFocus
          onCancel={() => setAdding(false)}
          onSubmit={async (fields) => {
            await addLogin(site, fields, addBots, addExact);
            setAdding(false);
            setSite("");
            setAddBots("all");
            setAddExact(false);
            await load();
          }}>
          <ExactHostChoice checked={addExact} onChange={setAddExact} label={t("settings.logins.exactHost")} />
          <LoginBotPicker value={addBots} onChange={setAddBots} bots={bots} />
        </LoginForm>,
      )}
      {editingLogin && loginForm(editingLogin.site, () => setEditing(null),
        <>
          <LoginForm username={false} replacing compact submitLabel={t("settings.logins.saveChange")} autoFocus
            onCancel={() => setEditing(null)}
            onSubmit={async (fields) => {
              await changeLogin(editingLogin.id, { password: fields.password, totp: fields.totp, removeTotp, bots: editBots, ...(editExact === editingLogin.exactHost ? {} : { exactHost: editExact }) });
              setEditing(null);
              await load();
            }}>
            {editingLogin.hasTotp && (
              <label className="flex items-center gap-2 text-[13px] leading-[18px] text-ink">
                <input type="checkbox" checked={removeTotp} onChange={(event) => setRemoveTotp(event.target.checked)} />
                {t("settings.logins.removeTotp")}
              </label>
            )}
            <ExactHostChoice checked={editExact} onChange={setEditExact}
              label={t("settings.logins.exactHostFor", { hosts: editingLogin.hosts.join(", "), site: editingLogin.site })} />
            <LoginBotPicker value={editBots} onChange={setEditBots} bots={bots} />
          </LoginForm>
          <div className="mt-3 flex justify-start">
            <button type="button" className={cn(mdSecondaryCls, deleting === editingLogin.id && "bg-danger text-danger-ink enabled:hover:bg-danger")} disabled={busy}
              onClick={() => void remove(editingLogin.id)}
              aria-label={deleting === editingLogin.id ? t("settings.logins.deleteConfirm") : t("settings.logins.deleteFor", { site: editingLogin.site })}>
              {deleting === editingLogin.id ? t("settings.logins.deleteConfirm") : t("settings.logins.delete")}
            </button>
          </div>
        </>,
      )}
      <OnePasswordConnection status={onePassword} disabled={logins === null} bots={bots} botNames={botNames}
        onChange={async (next) => { setOnePassword(next); await load(); }} />
    </>
  );
}

/** Where a login signs in beyond its site's own pages, or that it is kept to those hosts. */
function signInHostsLine(login: LoginSummary): string | null {
  if (login.exactHost) return t("settings.logins.onlyOn", { hosts: login.hosts.join(", ") });
  const elsewhere = login.hosts.filter((host) => host !== login.site);
  return elsewhere.length ? t("settings.logins.signsInOn", { hosts: elsewhere.join(", ") }) : null;
}

function ExactHostChoice({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: string }) {
  return (
    <label className="flex items-start gap-2 text-[13px] leading-[18px] text-ink">
      <input type="checkbox" name="exactHost" className="mt-[2px]" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      {label}
    </label>
  );
}

function VaultAccess({ vault, bots, botNames, disabled, onChange }: {
  vault: OnePasswordVault;
  bots: ReadonlyArray<{ id: string; name: string }>;
  botNames: (value: LoginBots) => string;
  disabled: boolean;
  onChange: (status: OnePasswordStatus) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState<LoginBots>(vault.bots);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setError(null);
    try { await onChange(await grantVault(vault.id, value)); setEditing(false); }
    catch (cause) { setError(cause instanceof Error && cause.message ? cause.message : t("settings.logins.onePassword.error")); }
    finally { setBusy(false); }
  };
  return (
    <li className="flex flex-col" data-vault={vault.title}>
      <NavRow title={vault.title} hint={t("settings.logins.onePassword.vaultUse", { count: String(vault.items), who: botNames(vault.bots) })}
        disabled={disabled || busy} aria-expanded={editing} aria-label={t("settings.logins.onePassword.changeVault", { vault: vault.title })}
        onClick={() => { setValue(vault.bots); setEditing(!editing); }} />
      {editing && (
        <div className="flex flex-col gap-2 px-2 pb-2 pt-1">
          <LoginBotPicker value={value} onChange={setValue} bots={bots} disabled={busy} />
          {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className="ui-button" disabled={busy} onClick={() => setEditing(false)}>{t("logins.cancel")}</button>
            <button type="button" className="ui-button ui-button-primary" disabled={busy} onClick={() => void save()}>{t("settings.logins.saveChange")}</button>
          </div>
        </div>
      )}
    </li>
  );
}

function OnePasswordConnection({ status, disabled, bots, botNames, onChange }: {
  status: OnePasswordStatus;
  disabled: boolean;
  bots: ReadonlyArray<{ id: string; name: string }>;
  botNames: (value: LoginBots) => string;
  onChange: (status: OnePasswordStatus) => Promise<void>;
}) {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState<"connect" | "refresh" | "disconnect" | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (kind: NonNullable<typeof busy>, work: () => Promise<OnePasswordStatus>) => {
    if (busy) return;
    setBusy(kind);
    setError(null);
    try { await onChange(await work()); if (kind === "connect") { setToken(""); setConnecting(false); } }
    catch (cause) { setError(cause instanceof Error && cause.message ? cause.message : t("settings.logins.onePassword.error")); }
    finally { setBusy(null); }
  };
  const connect = (event: FormEvent) => {
    event.preventDefault();
    if (token.trim()) void run("connect", () => connectOnePassword(token.trim()));
  };
  return (
    <SettingsGroup label={t("settings.logins.onePassword.title")} block="onepassword">
      <section aria-label={t("settings.logins.onePassword.title")} data-onepassword>
        <SettingsRows>
          {status.connected ? (
            <>
              <ItemRow title={t("settings.logins.onePassword.title")}
                hint={t("settings.logins.onePassword.connected", { vaults: (status.vaults ?? []).map((vault) => vault.title).join(", ") || "-", count: String(status.items ?? 0) })} />
              {status.error && <NoteRow tone="danger">{status.error}</NoteRow>}
              {!!status.vaults?.length && (
                <ul className="flex flex-col" aria-label={t("settings.logins.onePassword.vaults")}>
                  {status.vaults.map((vault) => <VaultAccess key={vault.id} vault={vault} bots={bots} botNames={botNames} disabled={disabled} onChange={onChange} />)}
                </ul>
              )}
              <NavRow drill={false} disabled={disabled || busy !== null} title={t("settings.logins.onePassword.refresh")}
                value={busy === "refresh" ? <Loader2 size={13} className="animate-spin" /> : undefined} onClick={() => void run("refresh", refreshOnePassword)} />
              <NavRow drill={false} disabled={disabled || busy !== null} title={t("settings.logins.onePassword.disconnect")} onClick={() => void run("disconnect", disconnectOnePassword)} />
            </>
          ) : (
            <>
              <NavRow data-settings-open="onepassword" title={t("settings.logins.onePassword.title")} hint={t("settings.w6c.logins.onePasswordGuide")}
                disabled={disabled} onClick={() => setConnecting(true)} />
              {connecting && (
                <DialogPane.Provider value={false}>
                  <GrokDialog data-panel-modal="onepassword" title={t("settings.logins.onePassword.title")} description={t("settings.w6c.logins.onePasswordGuide")} onClose={() => setConnecting(false)}>
                    <form className="flex flex-col gap-3" onSubmit={connect}>
                      <input name="onePasswordToken" type="password" autoComplete="off" spellCheck={false} maxLength={8192} value={token} data-autofocus
                        onChange={(event) => setToken(event.target.value)} disabled={disabled || busy !== null}
                        aria-label={t("settings.logins.onePassword.token")} placeholder={t("settings.logins.onePassword.token")}
                        className={textFieldCls} />
                      {error && <p role="alert" className="m-0 text-[12px] leading-4 text-danger">{error}</p>}
                      <div className="flex justify-end gap-2">
                        <button type="button" className={mdSecondaryCls} onClick={() => setConnecting(false)}>{t("common.cancel")}</button>
                        <button type="submit" className={mdPrimaryCls} disabled={disabled || busy !== null || !token.trim()}>
                          {busy === "connect" && <Loader2 size={13} className="animate-spin" />}{t("settings.logins.onePassword.connect")}
                        </button>
                      </div>
                    </form>
                  </GrokDialog>
                </DialogPane.Provider>
              )}
            </>
          )}
        </SettingsRows>
        {error && !connecting && <p role="alert" className="mt-2 px-3 text-[12px] leading-4 text-danger">{error}</p>}
      </section>
    </SettingsGroup>
  );
}
