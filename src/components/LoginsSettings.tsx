import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Loader2, Plus } from "lucide-react";

import type { LoginBots, LoginSummary, OnePasswordStatus, OnePasswordVault } from "../../shared/logins";
import { t } from "@/lib/i18n";
import { addLogin, changeLogin, connectOnePassword, deleteLogin, disconnectOnePassword, grantVault, listLogins, refreshOnePassword } from "@/lib/logins";
import { relativeTime } from "@/lib/memory";
import { useOwnerOrAdmin } from "@/lib/use-owner-or-admin";
import { useStore } from "@/state/store";
import { LoginBotPicker, LoginForm } from "./LoginForm";
import { Card, SettingRow, SettingsGroup, SettingsRows } from "./SettingsPrimitives";
import { textFieldCls } from "./ui/GrokDialog";
import { cn } from "@/lib/cn";

// Security: a row never shows the password, which no route returns.

const SOURCE_KEYS = {
  card: "settings.logins.source.card",
  settings: "settings.logins.source.settings",
  "1password": "settings.logins.source.1password",
} as const;

const ROW = "flex min-h-12 flex-wrap items-center gap-x-5 gap-y-2 px-3.5 py-2.5";
const SECONDARY = "text-[13px] leading-[18px] tracking-[-0.08px] text-ink-secondary";

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
    try { await deleteLogin(id); setDeleting(null); await load(); }
    catch (cause) { setError(cause instanceof Error && cause.message ? cause.message : t("settings.logins.deleteError")); }
    finally { setBusy(false); }
  };

  const loginForm = (form: ReactNode) => <div className="px-3.5 pb-3 pt-1">{form}</div>;

  return (
    <>
      <SettingsGroup label={t("settings.section.logins")} block="logins" footnote={adding || editing ? t("logins.private") : undefined}>
        {state.config?.cloudHome === true && <p className="pl-3.5 text-[12px] leading-4 text-ink-tertiary" data-logins-cloud-own>{t("settings.logins.cloudOwn")}</p>}
        <SettingsRows>
          <div aria-busy={logins === null || busy} className="flex flex-col">
            {logins === null && !error && <SettingRow title={t("settings.logins.loading")}>{null}</SettingRow>}
            {logins?.length === 0 && !adding && <p className="px-3.5 py-2.5 text-[13px] leading-[18px] text-ink-secondary">{t("settings.w6c.logins.empty")}</p>}
            {!!logins?.length && (
              <ul className="flex flex-col" data-logins-list>
                {logins.map((login) => (
                  <li key={login.id} className="flex flex-col" data-login-row={login.site}>
                    <div className={ROW}>
                      <div className="min-w-0 flex-1 basis-48">
                        <div dir="ltr" className="truncate text-[13px] leading-[18px] tracking-[-0.08px] text-ink" title={login.site}>
                          {login.site}{login.hasTotp && <span className="text-ink-secondary"> · {t("settings.logins.twoFactor")}</span>}
                        </div>
                        <div dir="auto" className={SECONDARY}>
                          {[login.username || t("settings.logins.noUsername"), t(SOURCE_KEYS[login.source]), botNames(login.bots),
                            login.lastUsedAt ? t("settings.logins.used", { when: relativeTime(login.lastUsedAt) }) : t("settings.logins.neverUsed")].join(" · ")}
                        </div>
                        {signInHostsLine(login) && <div dir="ltr" className={SECONDARY} data-login-hosts>{signInHostsLine(login)}</div>}
                      </div>
                      {login.source !== "1password" && (
                        <div className="ms-auto flex shrink-0 gap-2">
                          <button type="button" className="ui-button" disabled={busy} onClick={() => startEdit(login)}
                            aria-label={t("settings.logins.changeFor", { site: login.site })}>{t("settings.logins.change")}</button>
                          <button type="button" className={cn("ui-button", deleting === login.id && "ui-button-danger")} disabled={busy} onClick={() => void remove(login.id)}
                            aria-label={deleting === login.id ? t("settings.logins.deleteConfirm") : t("settings.logins.deleteFor", { site: login.site })}>
                            {deleting === login.id ? t("settings.logins.deleteConfirm") : t("settings.logins.delete")}
                          </button>
                        </div>
                      )}
                    </div>
                    {editing === login.id && loginForm(
                      <LoginForm username={false} replacing compact submitLabel={t("settings.logins.saveChange")} autoFocus
                        onCancel={() => setEditing(null)}
                        onSubmit={async (fields) => {
                          await changeLogin(login.id, { password: fields.password, totp: fields.totp, removeTotp, bots: editBots, ...(editExact === login.exactHost ? {} : { exactHost: editExact }) });
                          setEditing(null);
                          await load();
                        }}>
                        {login.hasTotp && (
                          <label className="flex items-center gap-2 text-[13px] leading-[18px] text-ink">
                            <input type="checkbox" checked={removeTotp} onChange={(event) => setRemoveTotp(event.target.checked)} />
                            {t("settings.logins.removeTotp")}
                          </label>
                        )}
                        <ExactHostChoice checked={editExact} onChange={setEditExact}
                          label={t("settings.logins.exactHostFor", { hosts: login.hosts.join(", "), site: login.site })} />
                        <LoginBotPicker value={editBots} onChange={setEditBots} bots={bots} />
                      </LoginForm>,
                    )}
                  </li>
                ))}
              </ul>
            )}
            {adding ? loginForm(
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
            ) : (
              <div className="flex justify-end px-3.5 py-2.5">
                <button type="button" className="ui-button" disabled={logins === null}
                  onClick={() => { setEditing(null); setDeleting(null); setAdding(true); }}>
                  <Plus size={13} />{t("settings.logins.add")}
                </button>
              </div>
            )}
          </div>
        </SettingsRows>
        {error && <p role="alert" className="pl-3.5 text-[12px] leading-4 text-danger">{error}</p>}
      </SettingsGroup>
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
      <div className={ROW}>
        <div className="min-w-0 flex-1 basis-48">
          <div className="truncate text-[13px] leading-[18px] tracking-[-0.08px] text-ink">{vault.title}</div>
          <div className={SECONDARY}>{t("settings.logins.onePassword.vaultUse", { count: String(vault.items), who: botNames(vault.bots) })}</div>
        </div>
        {!editing && (
          <button type="button" className="ui-button ms-auto" disabled={disabled || busy} onClick={() => { setValue(vault.bots); setEditing(true); }}
            aria-label={t("settings.logins.onePassword.changeVault", { vault: vault.title })}>{t("settings.logins.change")}</button>
        )}
      </div>
      {editing && (
        <div className="flex flex-col gap-2 px-3.5 pb-3">
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
  const [error, setError] = useState<string | null>(null);
  const run = async (kind: NonNullable<typeof busy>, work: () => Promise<OnePasswordStatus>) => {
    if (busy) return;
    setBusy(kind);
    setError(null);
    try { await onChange(await work()); if (kind === "connect") setToken(""); }
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
              <div className={ROW}>
                <div className="min-w-0 flex-1 basis-48">
                  <div className="text-[13px] leading-[18px] tracking-[-0.08px] text-ink">{t("settings.logins.onePassword.title")}</div>
                  <div className={SECONDARY}>
                    {t("settings.logins.onePassword.connected", { vaults: (status.vaults ?? []).map((vault) => vault.title).join(", ") || "—", count: String(status.items ?? 0) })}
                  </div>
                </div>
                <div className="ms-auto flex shrink-0 gap-2">
                  <button type="button" className="ui-button" disabled={disabled || busy !== null} onClick={() => void run("refresh", refreshOnePassword)}>
                    {busy === "refresh" && <Loader2 size={13} className="animate-spin" />}{t("settings.logins.onePassword.refresh")}
                  </button>
                  <button type="button" className="ui-button" disabled={disabled || busy !== null} onClick={() => void run("disconnect", disconnectOnePassword)}>
                    {t("settings.logins.onePassword.disconnect")}
                  </button>
                </div>
              </div>
              {status.error && <p role="alert" className="px-3.5 pb-2.5 text-[13px] leading-[18px] text-danger">{status.error}</p>}
              {!!status.vaults?.length && (
                <ul className="flex flex-col" aria-label={t("settings.logins.onePassword.vaults")}>
                  {status.vaults.map((vault) => <VaultAccess key={vault.id} vault={vault} bots={bots} botNames={botNames} disabled={disabled} onChange={onChange} />)}
                </ul>
              )}
            </>
          ) : (
            <form className={ROW} onSubmit={connect}>
              <div className="min-w-0 flex-1 basis-48">
                <div className="text-[13px] leading-[18px] tracking-[-0.08px] text-ink">{t("settings.logins.onePassword.title")}</div>
                <div className={SECONDARY}>{t("settings.w6c.logins.onePasswordGuide")}</div>
              </div>
              <div className="ms-auto flex shrink-0 flex-wrap items-center justify-end gap-2">
                <input name="onePasswordToken" type="password" autoComplete="off" spellCheck={false} maxLength={8192} value={token}
                  onChange={(event) => setToken(event.target.value)} disabled={disabled || busy !== null}
                  aria-label={t("settings.logins.onePassword.token")} placeholder={t("settings.logins.onePassword.token")}
                  className={cn(textFieldCls, "w-56")} />
                <button type="submit" className="ui-button" disabled={disabled || busy !== null || !token.trim()}>
                  {busy === "connect" && <Loader2 size={13} className="animate-spin" />}{t("settings.logins.onePassword.connect")}
                </button>
              </div>
            </form>
          )}
        </SettingsRows>
        {error && <p role="alert" className="mt-2 pl-3.5 text-[12px] leading-4 text-danger">{error}</p>}
      </section>
    </SettingsGroup>
  );
}
