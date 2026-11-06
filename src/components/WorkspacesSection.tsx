import { useCallback, useEffect, useState } from "react";
import { api, useStore, type ConfigStatus } from "@/state/store";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { formatUsd, hasFiniteCost } from "@/lib/usage";
import { ConfirmDialog } from "./ConfirmDialog";
import { CopyLink } from "./PeopleSection";
import { Card as RowsCard, FormDialog, FormField, ItemRow, NoteRow, SwitchRow, pillCls } from "./ListRows";
import { textFieldCls } from "./ui/GrokDialog";

export interface FleetWorkspaceView {
  slug: string;
  host: string;
  port: number;
  status: "running" | "suspended" | "provisioning" | "error" | "retained";
  createdAt: string;
  live: string;
  usage: { month: string; turns: number | null; costUsd: number | null; billableUsd: number | null; unavailable?: boolean };
}

export interface FleetView {
  domain: string;
  operator: string | null;
  workspaces: FleetWorkspaceView[];
}

export function workspacesAvailable(config: ConfigStatus | null | undefined): boolean {
  return config?.edition?.features?.includes("admin") === true && config?.fleet?.available === true;
}

const fetchFleet = (): Promise<FleetView> => api("/api/fleet");

export function WorkspacesTable({ fleet, onAct, busy }: { fleet: FleetView; onAct: (slug: string, action: "suspend" | "resume" | "delete" | "users") => void; busy: string | null }) {
  if (fleet.workspaces.length === 0) return <NoteRow>{t("workspaces.empty", { domain: fleet.domain })}</NoteRow>;
  return (
    <>
      {fleet.workspaces.map((workspace) => {
        const suspended = workspace.status === "suspended";
        const operational = workspace.status === "running" || suspended;
        const state = workspace.status === "provisioning" ? t("workspaces.provisioning")
          : workspace.status === "error" ? t("workspaces.error")
          : workspace.status === "retained" ? t("workspaces.retained")
          : suspended ? t("workspaces.suspended") : workspace.live === "active" ? t("workspaces.running") : workspace.live;
        const tone = suspended || workspace.status === "provisioning" ? "text-warning" : workspace.status === "running" && workspace.live === "active" ? "text-success" : "text-danger";
        return (
          <ItemRow key={workspace.slug} title={workspace.slug} hint={<>
            <a href={`https://${workspace.host}`} target="_blank" rel="noreferrer" className="hover:text-ink hover:underline">{workspace.host}</a>
            {" · "}<span className={tone}>{state}</span>
            {" · "}<span className="tabular-nums" title={workspace.usage.turns === null ? undefined : t("workspaces.turns", { turns: String(workspace.usage.turns) })}>
              {hasFiniteCost(workspace.usage.costUsd) ? formatUsd(workspace.usage.costUsd) : "-"}
              {hasFiniteCost(workspace.usage.billableUsd) && <> · {formatUsd(workspace.usage.billableUsd)}</>}
            </span>
            {!operational && <span className="block">{t("workspaces.recoveryHint")}</span>}
          </>}>
            {operational && <>
              <button type="button" disabled={busy !== null} onClick={() => onAct(workspace.slug, "users")} className="ui-button">{t("workspaces.users")}</button>
              <button type="button" disabled={busy !== null} onClick={() => onAct(workspace.slug, suspended ? "resume" : "suspend")} className="ui-button">{suspended ? t("workspaces.resume") : t("workspaces.suspend")}</button>
              <button type="button" disabled={busy !== null} onClick={() => onAct(workspace.slug, "delete")} className="ui-button text-danger">{t("workspaces.delete")}</button>
            </>}
          </ItemRow>
        );
      })}
    </>
  );
}

function NewWorkspaceForm({ domain, onCreated, onClose, disabled }: { domain: string; onCreated: (log: string[], created: { slug: string; admin: string }) => void; onClose: () => void; disabled: boolean }) {
  const [slug, setSlug] = useState("");
  const [admin, setAdmin] = useState("");
  const [members, setMembers] = useState("");
  const [cap, setCap] = useState("");
  const [anthropicKey, setAnthropicKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const body = {
        slug: slug.trim().toLowerCase(),
        admins: [admin.trim()],
        members: members.split(/[,\s]+/).map((item) => item.trim()).filter(Boolean),
        ...(cap.trim() ? { cap: Number(cap) } : {}),
        ...(anthropicKey.trim() ? { anthropicKey: anthropicKey.trim() } : {}),
      };
      const result: { log?: string[] } = await api("/api/fleet/workspaces", { method: "POST", body: JSON.stringify(body) });
      setSlug(""); setAdmin(""); setMembers(""); setCap(""); setAnthropicKey("");
      onCreated(result.log ?? [], { slug: body.slug, admin: body.admins[0]! });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormDialog data-panel-modal="workspace-new" title={t("workspaces.new")} description={t("workspaces.createHint")} width={460}
      saveLabel={saving ? t("workspaces.creating") : t("workspaces.create")} canSave={Boolean(slug.trim() && admin.trim())} busy={disabled || saving}
      error={error ?? undefined} onSave={create} onClose={onClose}>
      <FormField label={t("workspaces.name")}>
        <span className="flex items-center gap-1.5">
          <input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="acme" pattern="[a-z][a-z0-9-]{1,30}" required disabled={disabled || saving} aria-label={t("workspaces.name")} className={textFieldCls} />
          <span className="whitespace-nowrap text-[12px] text-ink-secondary">.{domain}</span>
        </span>
      </FormField>
      <FormField label={t("workspaces.adminEmail")}>
        <input value={admin} onChange={(e) => setAdmin(e.target.value)} type="email" required disabled={disabled || saving} aria-label={t("workspaces.adminEmail")} className={textFieldCls} />
      </FormField>
      <FormField label={t("workspaces.members")}>
        <input value={members} onChange={(e) => setMembers(e.target.value)} placeholder="bob@acme.test, @acme.test" disabled={disabled || saving} aria-label={t("workspaces.members")} className={textFieldCls} />
      </FormField>
      <FormField label={t("workspaces.cap")}>
        <input value={cap} onChange={(e) => setCap(e.target.value)} inputMode="decimal" placeholder="50" disabled={disabled || saving} aria-label={t("workspaces.cap")} className={textFieldCls} />
      </FormField>
      <FormField label={t("workspaces.anthropicKey")}>
        <input value={anthropicKey} onChange={(e) => setAnthropicKey(e.target.value)} type="password" autoComplete="off" placeholder="sk-ant-…" disabled={disabled || saving} aria-label={t("workspaces.anthropicKey")} className={textFieldCls} />
      </FormField>
    </FormDialog>
  );
}

function UsersForm({ slug, onDone, onClose }: { slug: string; onDone: (log: string[]) => void; onClose: () => void }) {
  const [email, setEmail] = useState("");
  const [chatOnly, setChatOnly] = useState(false);
  const [busy, setBusy] = useState<"add" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (action: "add" | "remove") => {
    if (busy) return;
    setBusy(action);
    setError(null);
    try {
      const result: { log?: string[] } = await api(`/api/fleet/workspaces/${encodeURIComponent(slug)}/users`, { method: "POST", body: JSON.stringify({ action, email: email.trim(), chatOnly }) });
      setEmail("");
      onDone(result.log ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };
  return (
    <FormDialog data-panel-modal="workspace-users" title={t("workspaces.usersTitle", { slug })} error={error ?? undefined} onClose={onClose}>
      <FormField label={t("workspaces.email")}>
        <input value={email} onChange={(e) => setEmail(e.target.value)} type="text" placeholder="person@example.com or @example.com" aria-label={t("workspaces.email")} disabled={busy !== null} className={textFieldCls} />
      </FormField>
      <div className="-mx-2 flex flex-col">
        <SwitchRow title={t("workspaces.chatOnly")} checked={chatOnly} disabled={busy !== null} onChange={() => setChatOnly(!chatOnly)} />
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" disabled={busy !== null || !email.trim()} onClick={() => void run("remove")} className={cn(pillCls, "text-danger")}>{busy === "remove" ? t("workspaces.working") : t("workspaces.removeUser")}</button>
        <button type="button" disabled={busy !== null || !email.trim()} onClick={() => void run("add")} className={pillCls}>{busy === "add" ? t("workspaces.working") : t("workspaces.addUser")}</button>
      </div>
    </FormDialog>
  );
}

export function WorkspacesSection({ load = fetchFleet }: { load?: () => Promise<FleetView> }) {
  const { state } = useStore();
  const [fleet, setFleet] = useState<FleetView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [usersFor, setUsersFor] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ slug: string; keepData: boolean } | null>(null);
  const [creating, setCreating] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try { setFleet(await load()); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setLoading(false); }
  }, [load]);
  useEffect(() => { void refresh(); }, [refresh]);

  const act = async (slug: string, action: "suspend" | "resume" | "delete" | "users") => {
    if (action === "users") { setUsersFor((current) => (current === slug ? null : slug)); return; }
    if (action === "delete") { setConfirm({ slug, keepData: false }); return; }
    setBusy(slug);
    setError(null);
    try {
      const result: { log?: string[] } = await api(`/api/fleet/workspaces/${encodeURIComponent(slug)}/${action}`, { method: "POST" });
      setLog(result.log ?? []);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!confirm) return;
    const { slug, keepData } = confirm;
    setConfirm(null);
    setBusy(slug);
    setError(null);
    try {
      const result: { log?: string[] } = await api(`/api/fleet/workspaces/${encodeURIComponent(slug)}`, { method: "DELETE", body: JSON.stringify({ keepData }) });
      setLog(result.log ?? []);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const upgrade = async () => {
    setBusy("*");
    setError(null);
    try {
      const result: { log?: string[] } = await api("/api/fleet/upgrade", { method: "POST" });
      setLog(result.log ?? [t("workspaces.upgraded")]);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  if (!workspacesAvailable(state.config)) return null;
  return (
    <>
      <RowsCard label={t("workspaces.title")} footnote={t("workspaces.subtitle")} data-settings-block="fleet">
        <ItemRow title={t("workspaces.title")} hint={loading ? t("common.checking") : undefined}>
          <button type="button" onClick={() => void refresh()} disabled={loading || busy !== null} className="ui-button">{t("workspaces.refresh")}</button>
          <button type="button" onClick={() => void upgrade()} disabled={busy !== null || !fleet?.workspaces.length} className="ui-button">{busy === "*" ? t("workspaces.working") : t("workspaces.upgradeAll")}</button>
          <button type="button" onClick={() => setCreating(true)} disabled={busy !== null || !fleet} className="ui-button">{t("workspaces.new")}</button>
        </ItemRow>
        {inviteLink && <CopyLink link={inviteLink} />}
        {error && <NoteRow tone="danger">{error}</NoteRow>}
        {fleet && <WorkspacesTable fleet={fleet} onAct={(slug, action) => void act(slug, action)} busy={busy} />}
        {log.map((line, index) => <NoteRow key={index}>{line}</NoteRow>)}
      </RowsCard>
      {creating && fleet && <NewWorkspaceForm domain={fleet.domain} disabled={busy !== null} onClose={() => setCreating(false)}
        onCreated={(lines, created) => { setCreating(false); setLog(lines); setInviteLink(`https://${created.slug}.${fleet.domain}/pair?email=${encodeURIComponent(created.admin)}`); void refresh(); }} />}
      {usersFor && <UsersForm slug={usersFor} onClose={() => setUsersFor(null)} onDone={(lines) => { setLog(lines); void refresh(); }} />}
      <ConfirmDialog
        open={confirm !== null}
        title={t("workspaces.deleteTitle", { slug: confirm?.slug ?? "" })}
        // keeping the data is decided inside the question itself
        body={<>
          {t(confirm?.keepData ? "confirm.workspaceDeleteKeep" : "confirm.workspaceDelete")}
          {confirm && <label className="mt-3 flex cursor-pointer items-center gap-2 text-[13px] text-ink">
            <input type="checkbox" checked={confirm.keepData} onChange={(e) => setConfirm({ ...confirm, keepData: e.target.checked })} className="accent-accent" />{t("workspaces.keepData")}
          </label>}
        </>}
        confirmLabel={t("workspaces.delete")}
        onCancel={() => setConfirm(null)}
        onConfirm={() => void remove()}
      />
    </>
  );
}
