import { useState } from "react";
import type { WorkspaceSummary } from "../../../shared/dashboard-protocol";
import { useSession } from "../data/session";
import { api } from "../lib/api";
import { longDate } from "../lib/format";
import { setTheme, useTheme, type ThemePref } from "../lib/theme";
import { Button, Card, FreshnessTag, KV, PageHeader, SectionTitle, Segmented } from "../ui/kit";

function WorkspaceRow({ w }: { w: WorkspaceSummary }) {
  const { now, refresh, toast } = useSession();
  const [name, setName] = useState(w.name);
  const [editing, setEditing] = useState(false);
  const save = async () => {
    const next = name.trim();
    if (!next || next === w.name) { setEditing(false); setName(w.name); return; }
    try { await api.rename(w.id, next); toast(`Renamed to ${next}`); setEditing(false); refresh(); } catch (e) { toast((e as Error).message, "bad"); }
  };
  const forget = async () => {
    if (!window.confirm(`Remove ${w.name} from your dashboard? It stops reporting until you connect it again from the app.`)) return;
    try { await api.forget(w.id); toast(`Removed ${w.name}`); refresh(); } catch (e) { toast((e as Error).message, "bad"); }
  };
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
      <div className="min-w-0 flex-1">
        {editing ? (
          <form onSubmit={(e) => { e.preventDefault(); void save(); }} className="flex items-center gap-2">
            <label htmlFor={`name-${w.id}`} className="sr-only">Workspace name</label>
            <input id={`name-${w.id}`} value={name} maxLength={60} autoFocus onChange={(e) => setName(e.target.value)} className="h-9 w-full max-w-[280px] rounded-row border border-line-2 bg-transparent px-3 text-14 text-ink outline-none focus-visible:border-ink-3" />
            <Button size="sm" variant="primary" type="submit">Save</Button>
            <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setName(w.name); }}>Cancel</Button>
          </form>
        ) : (
          <>
            <div className="truncate text-14 text-ink">{w.name}</div>
            <div className="flex flex-wrap items-center gap-x-3 text-13 text-ink-3">
              <span>{w.kind === "vps" ? "VPS" : w.kind === "mac" ? "Mac" : "Server"} · {w.version} · connected {longDate(w.connectedAt)}</span>
              <FreshnessTag freshness={w.freshness} at={w.lastReportAt} now={now} className="!text-13" />
            </div>
          </>
        )}
      </div>
      {!editing && (
        <div className="flex gap-2">
          <Button size="sm" onClick={() => setEditing(true)}>Rename</Button>
          <Button size="sm" variant="danger" onClick={() => void forget()}>Remove</Button>
        </div>
      )}
    </li>
  );
}

export function SettingsPage() {
  const { account, workspaces, setAccount } = useSession();
  const theme = useTheme();
  return (
    <div>
      <PageHeader title="Settings" />
      <div className="flex flex-col gap-4">
        <Card>
          <SectionTitle action={<Button size="sm" onClick={() => void api.signOut().finally(() => setAccount(null))}>Sign out</Button>}>Account</SectionTitle>
          <dl className="divide-y divide-line">
            <KV k="Email" v={account?.email ?? ""} />
            <KV k="Signed in with" v="Your OpenMausBot account" />
          </dl>
        </Card>
        <Card>
          <SectionTitle>Appearance</SectionTitle>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-14 text-ink-3">Theme</span>
            <Segmented<ThemePref> label="Theme" value={theme} onChange={setTheme} options={[{ value: "dark", label: "Dark" }, { value: "light", label: "Light" }, { value: "system", label: "System" }]} />
          </div>
        </Card>
        <Card>
          <SectionTitle>Workspaces</SectionTitle>
          {workspaces?.length ? <ul className="divide-y divide-line">{workspaces.map((w) => <WorkspaceRow key={w.id} w={w} />)}</ul> : <p className="text-14 text-ink-3">None connected yet.</p>}
        </Card>
        <Card>
          <SectionTitle>Your data</SectionTitle>
          <p className="max-w-[68ch] text-14 leading-[1.6] text-ink-3">
            Workspaces send counts and states only: machine stats, bot names and models, computer states, device names and daily usage totals. Chats, prompts, files and passwords never leave your machines. Removing a workspace deletes what it sent.
          </p>
        </Card>
      </div>
    </div>
  );
}
