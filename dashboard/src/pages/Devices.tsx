import { Laptop, Server, Smartphone } from "lucide-react";
import { useSession } from "../data/session";
import { ago } from "../lib/format";
import { Badge, Card, PageHeader, SectionTitle } from "../ui/kit";
import { CommandButton, WorkspaceGate } from "./common";

const ICON = { size: 18, strokeWidth: 1.5 } as const;

export function DevicesPage() {
  const { now } = useSession();
  return (
    <div>
      <PageHeader title="Devices" sub="What can reach this workspace, and how." />
      <WorkspaceGate>
        {(detail) => {
          const d = detail.report?.devices;
          if (!d) return <Card><p className="text-14 text-ink-3">This workspace has not sent its devices yet.</p></Card>;
          const link = d.link;
          return (
            <div className="flex flex-col gap-4">
              <Card>
                <SectionTitle>This workspace</SectionTitle>
                <div className="flex items-center gap-4">
                  <span className="grid size-11 shrink-0 place-items-center rounded-[12px] bg-card-2 text-ink-2" aria-hidden>{d.thisDevice.kind === "mac" ? <Laptop {...ICON} /> : <Server {...ICON} />}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-14 text-ink">{d.thisDevice.label}</div>
                    <div className="text-13 text-ink-3">
                      {!link ? "Reached on this computer only" : link.connected ? (link.mode === "direct" ? "Linked to your app directly" : "Linked to your app through the relay") : link.mode === "off" ? "Not linked to an app" : "Link is down"}
                      {link?.since ? ` · since ${ago(link.since, now).replace(" ago", "")}` : ""}
                    </div>
                  </div>
                  {link && <Badge tone={link.connected ? "good" : "warn"}>{link.connected ? (link.mode === "direct" ? "Direct" : "Relay") : "Offline"}</Badge>}
                </div>
                {link?.detail && <p className="mt-4 text-13 leading-[1.5] text-ink-3">{link.detail}</p>}
              </Card>
              <Card aria-labelledby="phones-title">
                <SectionTitle id="phones-title">Phones</SectionTitle>
                {d.phones.length ? (
                  <ul className="divide-y divide-line">
                    {d.phones.map((p) => (
                      <li key={p.id} className="flex items-center gap-4 py-3">
                        <Smartphone {...ICON} className="shrink-0 text-ink-3" aria-hidden />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-14 text-ink">{p.label}</div>
                          <div className="truncate text-13 text-ink-3">{[p.platform, p.lastSeenAt ? `seen ${ago(p.lastSeenAt, now)}` : p.pairedAt ? `paired ${ago(p.pairedAt, now)}` : null].filter(Boolean).join(" · ")}</div>
                        </div>
                        <CommandButton kind="phone.revoke" target={p.id} label="Revoke" doing="Revoking…" variant="danger" confirm={`Revoke ${p.label}? It will need to pair again.`} />
                      </li>
                    ))}
                  </ul>
                ) : <p className="text-14 leading-[1.55] text-ink-3">No phones paired. In the app, open the account menu and choose Pair a phone, then scan the code with the OpenMausBot mobile app.</p>}
              </Card>
              <Card aria-labelledby="sessions-title">
                <SectionTitle id="sessions-title">Signed-in apps and browsers</SectionTitle>
                {d.sessions.length ? (
                  <ul className="divide-y divide-line">
                    {d.sessions.map((s) => (
                      <li key={s.id} className="flex items-center gap-4 py-3">
                        <Laptop {...ICON} className="shrink-0 text-ink-3" aria-hidden />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-14 text-ink">{s.label}</div>
                          <div className="truncate text-13 text-ink-3">{[s.scopes.includes("admin") ? "Owner" : "Member", s.lastSeenAt ? `active ${ago(s.lastSeenAt, now)}` : s.createdAt ? `signed in ${ago(s.createdAt, now)}` : null].filter(Boolean).join(" · ")}</div>
                        </div>
                        <CommandButton kind="session.revoke" target={s.id} label="Sign out" doing="Signing out…" variant="danger" confirm={`Sign ${s.label} out of this workspace?`} />
                      </li>
                    ))}
                  </ul>
                ) : <p className="text-14 text-ink-3">Only the app on this computer. Nothing else is signed in.</p>}
              </Card>
            </div>
          );
        }}
      </WorkspaceGate>
    </div>
  );
}
