import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { Card as RowsCard, ItemRow, NavRow, NoteRow, SwitchRow } from "./ListRows";
import { useStore } from "@/state/store";
import { sharedComputersEnabled } from "@/lib/feature-flags";
import { LendingActivityList } from "./LendingActivity";

/** Security: grants are edited locally and confirmed by a native dialog, never by the hosted page. */
export function ComputerSharingSettings({ workspace, onClose }: { workspace: { id: string; name: string; origin: string }; onClose: () => void }) {
  const { state: appState } = useStore();
  const offered = sharedComputersEnabled(appState.config);
  const bridge = offered ? window.ogb?.computerSharing : undefined;
  const [state, setState] = useState<DesktopComputerSharing | null>(null);
  const [folders, setFolders] = useState<DesktopSharedFolder[]>([]);
  const [terminal, setTerminal] = useState(false);
  const [computer, setComputer] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [activity, setActivity] = useState<DesktopLendingActivity[] | null>(null);
  const mounted = useRef(false);
  const pending = useRef(false);
  const panel = useRef<HTMLDivElement>(null);
  const apply = (next: DesktopComputerSharing) => {
    setState(next); setFolders(next.folders); setTerminal(next.terminal); setComputer(next.computer);
  };
  useEffect(() => {
    mounted.current = true;
    panel.current?.scrollIntoView({ block: "start" });
    void bridge?.state(workspace.id).then(next => { if (mounted.current) apply(next); })
      .catch(() => { if (mounted.current) setError("Could not load computer access. Reopen this page to try again."); });
    const refresh = () => {
      void bridge?.state(workspace.id).then(next => { if (mounted.current) setState(next); }).catch(() => {});
      void bridge?.activity?.(workspace.id).then(next => { if (mounted.current) setActivity(next); }).catch(() => {});
    };
    refresh();
    const timer = setInterval(refresh, 3000);
    return () => { mounted.current = false; clearInterval(timer); };
  }, [bridge, workspace.id]);
  const perform = async (action: () => Promise<void>) => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError("");
    try { await action(); }
    catch (failure) { if (mounted.current) setError(String((failure as Error)?.message ?? failure).replace(/^Error invoking remote method '[^']*':\s*(?:Error:\s*)?/, "")); }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  };
  if (!bridge) return null;
  const locked = busy || !state;
  const status = !state ? "Loading access…" : !state.enabled ? "Not shared" : state.connected ? "Sharing while this desktop is open" : "Waiting for the workspace to connect";
  return <div ref={panel} className="flex flex-col gap-5">
    <RowsCard label={`Computer access · ${workspace.name}`} footnote="Shared files and screen content may be sent to its AI provider. Access stays on when you switch workspaces, until you stop sharing or close the desktop app.">
      <ItemRow title={<span role="status">{status}</span>} hint={workspace.origin}>
        <button type="button" aria-label="Close computer access" onClick={onClose}
          className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-ink-secondary hover:bg-ink/[0.035] hover:text-ink outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus">
          <X size={14} aria-hidden="true" />
        </button>
      </ItemRow>
    </RowsCard>
    <RowsCard label="Shared folders" footnote="Small files only (256 KB). Folder access does not follow links or delete files.">
      {folders.length === 0 && <NoteRow>No folders shared. New folders are read-only by default.</NoteRow>}
      {folders.map(folder => <SwitchRow key={folder.id} title={folder.name} hint={<span className="break-all">{folder.path}</span>} label={`Allow edits in ${folder.name}`}
        checked={folder.write} disabled={locked}
        onChange={() => setFolders(current => current.map(entry => entry.id === folder.id ? { ...entry, write: !entry.write } : entry))}
        extra={<button type="button" aria-label={`Remove ${folder.name}`} disabled={locked} onClick={() => setFolders(current => current.filter(entry => entry.id !== folder.id))}
          className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-ink-secondary hover:bg-ink/[0.035] hover:text-ink outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus disabled:opacity-45"><X size={13} aria-hidden="true" /></button>} />)}
      <NavRow drill={false} title="Choose folder" disabled={locked || folders.length >= 20} onClick={() => void perform(async () => {
        const folder = await bridge.chooseFolder();
        if (mounted.current && folder) setFolders(current => current.some(entry => entry.path === folder.path) ? current : [...current, folder]);
      })} />
    </RowsCard>
    <RowsCard label="Broader access · optional">
      <SwitchRow title="Unrestricted terminal" hint="Run commands as you. This can access or delete files anywhere you can, including credentials, not just the folders above."
        checked={terminal} disabled={locked} onChange={() => setTerminal(!terminal)} />
      <SwitchRow title="Computer control" hint="View your screen and operate your signed-in apps, outside the shared folders. Requires local computer control and OS permissions."
        checked={computer} disabled={locked} onChange={() => setComputer(!computer)} />
    </RowsCard>
    <RowsCard footnote={state?.enabled ? "Stopping blocks new requests and cancels running work where possible. An action already sent to an app may still finish." : undefined}>
      <ItemRow title={state?.enabled ? "Save changes" : "Share with this workspace"}>
        {state?.enabled && <button type="button" disabled={busy} onClick={() => void perform(async () => {
          const next = await bridge.revoke(workspace.id); if (mounted.current) apply(next);
        })} className="ui-button ui-button-danger">Stop sharing</button>}
        <button type="button" disabled={busy || !state || (!folders.length && !terminal && !computer)} onClick={() => void perform(async () => {
          const next = await bridge.save(workspace.id, { folders, terminal, computer });
          if (mounted.current && next) apply(next);
        })} className="ui-button ui-button-primary">{state?.enabled ? "Save access" : "Share selected access"}</button>
      </ItemRow>
      {(error || state?.error) && <NoteRow tone="danger">{error || state?.error}</NoteRow>}
    </RowsCard>
    <LendingActivityList entries={activity} />
  </div>;
}
