import type { ReactNode } from "react";
import type { CommandKind, WorkspaceDetail } from "../../../../shared/dashboard-protocol";
import { useSession } from "../data/session";
import { Button, ButtonLink, Card, Skeleton } from "../ui/kit";
import { SkyEmpty } from "../ui/Sky";

export function LoadingPage() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <Skeleton className="h-9 w-72" />
      <div className="mt-8 grid gap-4 md:grid-cols-2">
        <Skeleton className="h-[200px] !rounded-card" />
        <Skeleton className="h-[200px] !rounded-card" />
      </div>
      <Skeleton className="mt-4 h-[280px] !rounded-card" />
    </div>
  );
}

export function LoadError({ error, retry }: { error: string; retry(): void }) {
  return <section><p role="alert" className="text-13 text-bad">{error}</p><Button className="mt-4" size="sm" onClick={retry}>Retry</Button></section>;
}

export function NoWorkspace() {
  return (
    <SkyEmpty
      title="Connect your first workspace"
      action={<ButtonLink to="/connect" variant="primary">How to connect</ButtonLink>}
    >
      Your bots live on your own Mac or VPS. Open Dusk Bot there, then choose Account dashboard in the account menu. It shows up here a few seconds later.
    </SkyEmpty>
  );
}

/** waits for the chosen workspace's newest report; says so when there is none yet */
export function WorkspaceGate({ children }: { children: (detail: WorkspaceDetail) => ReactNode }) {
  const { workspaces, workspacesError, workspace, detail, detailError, refresh } = useSession();
  if (workspacesError && workspaces === null) return <LoadError error={workspacesError} retry={refresh} />;
  if (workspaces === null) return <LoadingPage />;
  if (!workspace) return <NoWorkspace />;
  if (!detail) {
    return detailError ? (
      <Card><LoadError error={detailError} retry={refresh} /></Card>
    ) : <LoadingPage />;
  }
  if (!detail.report) {
    return (
      <SkyEmpty title={`Waiting for ${workspace.name}`}>
        It is connected but has not reported yet. Keep Dusk Bot running there; the first report usually lands within a few seconds.
      </SkyEmpty>
    );
  }
  return <>{children(detail)}</>;
}

/** a workspace action: sent as a command, picked up on the workspace's next report, then confirmed */
export function CommandButton({ kind, target, label, doing, variant = "outline", confirm, disabled }: { kind: CommandKind; target: string; label: string; doing: string; variant?: "outline" | "primary" | "danger" | "ghost"; confirm?: string; disabled?: boolean }) {
  const { command, pendingFor, workspace } = useSession();
  const last = pendingFor(kind, target);
  const busy = last?.status === "queued" || last?.status === "sent";
  const offline = workspace?.freshness === "offline" || workspace?.freshness === "waiting";
  return (
    <Button
      size="sm"
      variant={variant}
      disabled={busy || disabled || offline}
      aria-busy={busy}
      title={offline ? `${workspace?.name ?? "This workspace"} is offline` : undefined}
      onClick={() => { if (!confirm || window.confirm(confirm)) void command(kind, target, label); }}
    >
      {busy ? doing : label}
    </Button>
  );
}
