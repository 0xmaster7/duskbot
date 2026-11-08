import { useState } from "react";
import { Bot, Download, Lock, Plug, Trash2 } from "lucide-react";
import { useStore } from "../data/store";
import type { Account } from "../data/types";
import { ago, until } from "../lib/format";
import { Button, Card, CardHead, PageHead, Pill, STROKE, SubHead, Switch, Ticks } from "../ui/kit";
import { BotStack, EmptyState } from "../ui/Mascot";
import { ConfirmDialog } from "../ui/overlays";

function useAccount() {
  const { data, update, toast } = useStore();
  const set = (fn: (a: Account) => Account) => update((d) => ({ ...d, account: fn(d.account) }));
  const bots = (ids: string[]) => data.bots.filter((b) => ids.includes(b.id));
  return { a: data.account, now: data.now, set, toast, bots };
}

export function ConnectionsPage() {
  const { a, now, set, toast, bots } = useAccount();
  const disconnect = (id: string, name: string) => {
    const before = a.apps;
    set((x) => ({ ...x, apps: x.apps.filter((y) => y.id !== id) }));
    toast(`${name} disconnected from every bot`, () => set((x) => ({ ...x, apps: before })));
  };
  return (
    <>
      <PageHead title="Connections" sub="Apps your bots can use, your own AI accounts, and the vault. Secrets never leave your Cloud and are never shown here." />
      <Card>
        <CardHead icon={Plug} title="Connected apps" />
        {a.apps.length === 0 ? <EmptyState title="No apps connected" state="curious">Connect Gmail, Calendar or GitHub from a bot's chat in the app.</EmptyState> : (
          <ul className="px-4 pb-2">
            {a.apps.map((app) => (
              <li key={app.id} className="grid min-h-12 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 border-b border-row py-2 last:border-0 sm:grid-cols-[minmax(0,1fr)_140px_120px_auto]">
                <span className="min-w-0 text-13"><span className="font-medium">{app.name}</span><span className="block text-12 text-ink-3">{app.access}, used {app.lastUsedAt ? ago(app.lastUsedAt, now) : "never"}</span></span>
                <span className="sm:order-none"><BotStack bots={bots(app.bots)} size={18} /></span>
                <span className="hidden truncate text-12 text-ink-3 sm:block">{bots(app.bots).map((b) => b.name).join(", ")}</span>
                <span className="col-span-2 sm:col-span-1"><Button size="sm" variant="ghost" onClick={() => disconnect(app.id, app.name)}>Disconnect</Button></span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <SubHead title="Your own AI" id="ai" />
      <p className="-mt-1 mb-3 text-13 text-ink-3">Bots on these accounts are never billed by us. Their limits come from the provider, read live from the account.</p>
      <div className="grid gap-4 md:grid-cols-2">
        {a.aiAccounts.map((acc) => (
          <Card key={acc.id} className="p-4">
            <div className="flex items-center gap-2"><Bot size={16} strokeWidth={STROKE} className="text-ink-3" aria-hidden /><p className="text-14 font-medium">{acc.name}</p><Pill>{acc.plan}</Pill><span className="ms-auto">{acc.ok ? <Pill tone="good" dot>Connected</Pill> : <Pill tone="bad" dot>Sign in again</Pill>}</span></div>
            <dl className="mt-3">
              {acc.windows.length === 0 && <p className="text-13 text-ink-3">This provider does not report its limits.</p>}
              {acc.windows.map((w) => (
                <div key={w.label} className="flex h-9 items-center gap-3 border-b border-row last:border-0">
                  <dt className="flex-1 text-13 text-ink-3">{w.label} limit</dt>
                  <Ticks value={w.usedPercent} max={100} label={`${acc.name} ${w.label} limit ${w.usedPercent}% used`} />
                  <dd className="num w-36 text-end text-12 text-ink-3"><span className="font-medium text-ink">{w.usedPercent}%</span>{w.resetsAt ? `, resets ${until(w.resetsAt, now)}` : ""}</dd>
                </div>
              ))}
            </dl>
          </Card>
        ))}
      </div>

      <SubHead title="Vault" id="vault" />
      <Card>
        <CardHead icon={Lock} title="Saved logins and secrets"><span className="text-12 text-ink-3">Names only</span></CardHead>
        <ul className="px-4 pb-2">
          {a.vault.map((v) => (
            <li key={v.id} className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 border-b border-row py-2 last:border-0">
              <span className="min-w-0 flex-1 text-13"><span className="font-medium">{v.name}</span><span className="text-ink-3">, {v.kind.toLowerCase()}, changed {ago(v.updatedAt, now)}</span></span>
              <span className="text-12 text-ink-3">Usable by</span><BotStack bots={bots(v.bots)} size={18} />
            </li>
          ))}
        </ul>
        <p className="border-t border-row px-4 py-3 text-12 text-ink-3">Add or edit vault items in the app. Bots fill them in without ever seeing the value.</p>
      </Card>
    </>
  );
}

const EVENTS: Array<[key: string, title: string, note: string]> = [
  ["spend", "Spend alerts", "When a cap reaches the percentages you picked in Billing"],
  ["health", "My Cloud health", "Low memory, low disk, a restart or a failed update"],
  ["routines", "Failed routines", "A routine fails twice in a row"],
  ["approvals", "Approvals", "A bot is waiting for you before it acts"],
  ["invoices", "Invoices and receipts", "Each charge and top-up"],
  ["weekly", "Weekly summary", "What your bots did and what it cost, Monday mornings"],
];

export function NotificationsPage() {
  const { a, set, toast } = useAccount();
  const flip = (key: string, channel: "email" | "push", value: boolean) => {
    set((x) => ({ ...x, notifications: { ...x.notifications, [key]: { ...x.notifications[key]!, [channel]: value } } }));
    toast(`${EVENTS.find((e) => e[0] === key)![1]}: ${channel === "email" ? "email" : "app"} ${value ? "on" : "off"}`);
  };
  return (
    <>
      <PageHead title="Notifications" sub="What we tell you, and where. Approvals always reach the app." />
      <Card>
        <div className="grid h-9 grid-cols-[minmax(0,1fr)_64px_64px] items-center gap-3 border-b border-row px-4 text-12 text-ink-3" aria-hidden><span>Tell me about</span><span className="text-center">Email</span><span className="text-center">App</span></div>
        <ul>
          {EVENTS.map(([key, title, note]) => {
            const v = a.notifications[key] ?? { email: false, push: false };
            return (
              <li key={key} className="grid min-h-14 grid-cols-[minmax(0,1fr)_64px_64px] items-center gap-3 border-b border-row px-4 py-2 last:border-0">
                <span className="min-w-0"><span className="block text-13 font-medium">{title}</span><span className="block text-12 text-ink-3">{note}</span></span>
                <span className="flex justify-center"><Switch checked={v.email} label={`${title} by email`} onChange={(n) => flip(key, "email", n)} /></span>
                <span className="flex justify-center"><Switch checked={v.push} label={`${title} in the app`} disabled={key === "approvals"} onChange={(n) => flip(key, "push", n)} /></span>
              </li>
            );
          })}
        </ul>
      </Card>
      <p className="mt-3 text-12 text-ink-3">Emails go to {a.email}. Change it in Profile.</p>
    </>
  );
}

export function PrivacyPage() {
  const { a, toast } = useAccount();
  const [exporting, setExporting] = useState<"idle" | "preparing" | "sent">("idle");
  const [crash, setCrash] = useState(true);
  const [deleting, setDeleting] = useState(false);
  return (
    <>
      <PageHead title="Data & privacy" sub="Everything your bots know is yours. Take it with you, or delete it." />
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="min-w-[240px] flex-1">
            <p className="text-14 font-medium">Export everything</p>
            <p className="mt-0.5 text-13 text-ink-3">Chats, bots, memory, routines, usage and invoices as JSON, plus your files. We email {a.email} a link that works for 24 hours.</p>
          </div>
          <Button variant="primary" icon={Download} disabled={exporting !== "idle"} onClick={() => { setExporting("preparing"); setTimeout(() => { setExporting("sent"); toast("Export ready. Check your email."); }, 1800); }}>
            {exporting === "idle" ? "Request export" : exporting === "preparing" ? "Preparing" : "Link sent"}
          </Button>
        </div>
        <div className="mt-4 flex items-center gap-3 border-t border-row pt-4">
          <div className="flex-1"><p className="text-14 font-medium">Share crash reports</p><p className="mt-0.5 text-13 text-ink-3">Anonymous, no chat content. Helps fix the app, which is open source.</p></div>
          <Switch checked={crash} label="Share crash reports" onChange={(v) => { setCrash(v); toast(v ? "Crash reports on" : "Crash reports off"); }} />
        </div>
      </Card>
      <SubHead title="Delete account" id="delete" />
      <Card className="border-[#f1d2d2] p-4">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="min-w-[240px] flex-1">
            <p className="text-14 font-medium">Delete your account</p>
            <p className="mt-0.5 text-13 text-ink-3">Ends your plan, deletes My Cloud and everything on it, and refunds your unused balance. You have 7 days to change your mind.</p>
          </div>
          <Button variant="danger" icon={Trash2} onClick={() => setDeleting(true)}>Delete account</Button>
        </div>
      </Card>
      <ConfirmDialog open={deleting} onClose={() => setDeleting(false)} title="Delete your account?" word="delete" action="Delete account"
        consequences={["Your bots, chats, memory and routines on My Cloud", "My Cloud, its snapshots and bot computers", "Connected apps, vault items and API tokens"]}
        keeps={["Invoices, kept for tax law", "Bots running only on your own computers, which keep working offline"]}
        onConfirm={() => toast("Account scheduled for deletion. We emailed you a link to undo it within 7 days.")} />
    </>
  );
}
