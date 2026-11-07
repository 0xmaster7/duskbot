import { useMemo, useState, type ReactNode } from "react";
import { Camera, Download, ExternalLink, RefreshCw, RotateCcw } from "lucide-react";
import { useStore } from "../data/store";
import type { MachineSample } from "../data/types";
import { date, dateTime, time, until } from "../lib/format";
import { setQuery, useLocation } from "../lib/router";
import { LineChart } from "../ui/charts";
import { Button, ButtonLink, Card, CardHead, Field, Input, KV, Pill, Segmented, Select, SubHead } from "../ui/kit";
import { Mascot } from "../ui/Mascot";
import { ConfirmDialog } from "../ui/overlays";

type Tab = "overview" | "power" | "backups" | "settings";
type Span = "24h" | "7d" | "30d";
const HOURS: Record<Span, number> = { "24h": 24, "7d": 168, "30d": 720 };

function bucket(samples: MachineSample[], every: number) {
  const out: MachineSample[] = [];
  for (let i = 0; i < samples.length; i += every) {
    const part = samples.slice(i, i + every);
    const avg = (k: keyof MachineSample) => part.reduce((s, p) => s + p[k], 0) / part.length;
    out.push({ t: part[0]!.t, cpu: avg("cpu"), mem: avg("mem"), disk: avg("disk"), netMbps: avg("netMbps") });
  }
  return out;
}

function Metrics() {
  const { data } = useStore();
  const [span, setSpan] = useState<Span>("24h");
  const { now, prev, labels } = useMemo(() => {
    const all = data.machine.samples;
    const n = HOURS[span];
    const every = span === "24h" ? 1 : span === "7d" ? 4 : 12;
    const cur = bucket(all.slice(-n), every);
    const before = all.length >= n * 2 ? bucket(all.slice(-n * 2, -n), every) : null;
    const fmt = (t: number) => (span === "24h" ? time(t) : date(t));
    return { now: cur, prev: before, labels: cur.map((s) => fmt(s.t)) };
  }, [data.machine.samples, span]);
  const pctFmt = (v: number) => `${Math.round(v)}%`;
  const chart = (key: keyof MachineSample, title: string, format: (v: number) => string, max?: number, axis?: (v: number) => string) => (
    <Card>
      <CardHead title={title}><span className="num text-13 font-medium">{format(now[now.length - 1]![key])}</span></CardHead>
      <div className="px-3 pb-3">
        <LineChart label={`${title} over the last ${span}`} labels={labels} format={format} axis={axis} max={max} height={150}
          series={[{ label: "Now", values: now.map((s) => s[key]) }, ...(prev ? [{ label: "Period before", values: prev.map((s) => s[key]), dotted: true }] : [])]} />
      </div>
    </Card>
  );
  return (
    <>
      <SubHead title="Health">
        <Segmented size="sm" label="Time span" value={span} onChange={setSpan} options={[{ value: "24h", label: "24 hours" }, { value: "7d", label: "7 days" }, { value: "30d", label: "30 days" }]} />
      </SubHead>
      <div className="grid gap-4 md:grid-cols-2">
        {chart("cpu", "CPU", pctFmt, 100)}
        {chart("mem", "Memory", pctFmt, 100)}
        {chart("disk", "Disk", pctFmt, 100)}
        {chart("netMbps", "Network", (v) => `${v.toFixed(1)} Mb/s`, undefined, (v) => `${Math.round(v)}`)}
      </div>
      <p className="mt-3 text-12 text-ink-3">Times are in your timezone. The dotted line is the period before. A gap would mean the machine was off; there are none.</p>
    </>
  );
}

function PowerRow({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-row px-4 py-4 last:border-0">
      <div className="min-w-[240px] flex-1"><p className="text-14 font-medium">{title}</p><div className="mt-0.5 text-13 text-ink-3">{children}</div></div>
      {action}
    </div>
  );
}

export function MyCloudPage() {
  const { data, toast } = useStore();
  const { query } = useLocation();
  const tab = (query.get("tab") ?? "overview") as Tab;
  const m = data.machine;
  const last = m.samples[m.samples.length - 1]!;
  const up = Math.floor((data.now - m.startedAt) / 86_400_000);
  const free = Math.round(m.size.diskGb * (1 - last.disk / 100));
  const [confirm, setConfirm] = useState<null | "reset" | "delete" | { restore: string }>(null);
  const [name, setName] = useState(m.name);
  const [updateWin, setUpdateWin] = useState(m.updateWindow);
  return (
    <>
      <header className="flex flex-wrap items-center gap-4 pb-6">
        <span className="flex size-14 items-center justify-center rounded-card border border-line bg-surface shadow-card"><Mascot color="blue" body="cloud" size={40} state="humming" label="My Cloud" /></span>
        <div className="min-w-[180px] flex-1">
          <h1 className="flex items-center gap-2 text-24 font-semibold tracking-[-0.4px]">My Cloud <Pill tone="good" dot>Running</Pill></h1>
          <p className="mt-1 truncate font-mono text-12 text-ink-3">{m.host}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button icon={RefreshCw} onClick={() => toast("Restarting My Cloud. Running turns finish first; back in about a minute.")}>Restart</Button>
          <ButtonLink to="openmausbot://cloud" external variant="primary" icon={ExternalLink}>Open in the app</ButtonLink>
        </div>
      </header>

      <Card className="relative overflow-hidden">
        <img src="/art/sky-meadow.webp" alt="" className="pointer-events-none absolute inset-y-0 end-0 h-full w-1/2 object-cover object-top opacity-90 [mask-image:linear-gradient(90deg,transparent,black_60%)] max-md:hidden" />
        <div className="relative grid gap-6 p-5 md:grid-cols-2">
          <div>
            <p className="text-18 font-medium">Healthy.</p>
            <p className="mt-1 max-w-[46ch] text-14 text-ink-2">{Math.round(last.mem)}% memory in use, {free} GB of disk free, up {up} days. Your six bots and two computers live here.</p>
            <dl className="mt-4 max-w-[420px] rounded-[10px] bg-surface/90">
              <KV label="Region">{m.region}</KV>
              <KV label="Size">{m.size.vcpu} vCPU, {m.size.ramGb} GB memory, {m.size.diskGb} GB disk</KV>
              <KV label="Version">{m.version}</KV>
              <KV label="Next update">{dateTime(m.nextUpdateAt)}, {until(m.nextUpdateAt, data.now)}</KV>
            </dl>
          </div>
        </div>
      </Card>

      <div className="mt-6">
        <Segmented label="My Cloud sections" value={tab} onChange={(t) => setQuery({ tab: t === "overview" ? null : t })}
          options={[{ value: "overview", label: "Overview" }, { value: "power", label: "Power and updates" }, { value: "backups", label: "Backups" }, { value: "settings", label: "Settings" }]} />
      </div>

      {tab === "overview" && <Metrics />}

      {tab === "power" && (
        <Card className="mt-4">
          <PowerRow title="Restart" action={<Button icon={RefreshCw} onClick={() => toast("Restarting My Cloud. Back in about a minute.")}>Restart</Button>}>Bots pause for about a minute. Turns already running finish first.</PowerRow>
          <PowerRow title="Sleep">My Cloud stays on all the time; it is what your plan pays for. Bot computers sleep on their own when idle.</PowerRow>
          <PowerRow title="Updates" action={<Button onClick={() => toast("Updating now. Your files and logins stay.")}>Update now</Button>}>
            <span className="mt-2 flex max-w-[320px] flex-col gap-1.5">
              <label htmlFor="win" className="text-13 font-medium text-ink">Update window</label>
              <Select id="win" value={updateWin} onChange={(e) => { setUpdateWin(e.target.value); toast(`Updates run ${e.target.value.toLowerCase()}`); }}>
                {["Sundays, 4:00 to 5:00", "Every night, 3:00 to 4:00", "Saturdays, 2:00 to 3:00", "Only when I press Update now"].map((w) => <option key={w}>{w}</option>)}
              </Select>
            </span>
          </PowerRow>
          <PowerRow title="Reset from snapshot" action={<Button variant="danger" icon={RotateCcw} onClick={() => setConfirm("reset")}>Reset</Button>}>Rebuilds My Cloud from last night's snapshot. Anything changed since then is lost.</PowerRow>
        </Card>
      )}

      {tab === "backups" && (
        <Card className="mt-4">
          <CardHead title="Snapshots"><Button size="sm" icon={Camera} onClick={() => toast("Taking a snapshot. It shows here in a few minutes.")}>Take one now</Button></CardHead>
          <ul className="px-4 pb-2">
            {m.snapshots.map((s, i) => (
              <li key={s.id} className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 border-b border-row py-2 last:border-0">
                <span className="min-w-0 flex-1 text-13"><span className="font-medium">{dateTime(s.at)}</span>{i === 0 && <span className="ms-2 text-12 text-ink-3">latest</span>}</span>
                <Pill tone={s.kind === "manual" ? "accent" : "neutral"}>{s.kind === "manual" ? "Taken by you" : "Nightly"}</Pill>
                <span className="num w-16 text-end text-13 text-ink-3">{s.sizeGb} GB</span>
                <Button size="sm" onClick={() => setConfirm({ restore: s.id })}>Restore</Button>
                <Button size="sm" variant="ghost" icon={Download} aria-label={`Download snapshot from ${dateTime(s.at)}`} onClick={() => toast("Preparing the download. We'll email a link.")}>Download</Button>
              </li>
            ))}
          </ul>
          <p className="border-t border-row px-4 py-3 text-12 text-ink-3">Nightly snapshots are kept for 7 days and are included in your plan.</p>
        </Card>
      )}

      {tab === "settings" && (
        <>
          <Card className="mt-4 p-4">
            <form className="grid max-w-[560px] gap-4" onSubmit={(e) => { e.preventDefault(); toast("Saved"); }}>
              <Field label="Name" hint="Only you see this.">{(id, d) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} aria-describedby={d} />}</Field>
              <Field label="Region" hint="Moving regions copies everything to a new machine; ask in the app.">{(id, d) => <Input id={id} value={m.region} disabled aria-describedby={d} />}</Field>
              <div><Button type="submit" variant="primary" disabled={name === m.name}>Save</Button></div>
            </form>
          </Card>
          <SubHead title="Danger zone" />
          <Card className="border-[#f1d2d2]">
            <PowerRow title="Delete My Cloud" action={<Button variant="danger" onClick={() => setConfirm("delete")}>Delete machine</Button>}>Deletes the machine, its snapshots and both bot computers. Your plan ends at renewal.</PowerRow>
          </Card>
        </>
      )}

      <ConfirmDialog open={confirm === "reset"} onClose={() => setConfirm(null)} title="Reset My Cloud from last night's snapshot?" action="Reset"
        consequences={["Changes made since the snapshot", "Apps and packages installed since then"]} keeps={["Your bots, chats, files and logins up to the snapshot", "Invoices and usage history"]}
        onConfirm={() => toast("Resetting from the snapshot. Bots are back in a few minutes.")} />
      <ConfirmDialog open={typeof confirm === "object" && confirm !== null} onClose={() => setConfirm(null)} title="Restore this snapshot?" action="Restore"
        consequences={["Everything changed on My Cloud after this snapshot"]} keeps={["A snapshot of right now, taken first, so you can undo"]}
        onConfirm={() => toast("Restoring. We took a snapshot of now first.")} />
      <ConfirmDialog open={confirm === "delete"} onClose={() => setConfirm(null)} title="Delete My Cloud?" word="delete" action="Delete machine"
        consequences={["The machine and everything on it", "All snapshots", "Both bot computers and their files"]} keeps={["Your account, balance and invoices", "Bots and chats on your own computers"]}
        onConfirm={() => toast("My Cloud is scheduled for deletion. You have 7 days to undo from the app.")} />
    </>
  );
}
