import { useState, type ReactNode } from "react";
import { dayKey } from "../lib/format";
import { useAdmin } from "./api";
import { RangePicker, duration, rangeOf, type Range } from "./kit";
import { AdminHeader, DayBars, Failed, Loading, Section, Tile, n } from "./ui";

interface CountRow { key: string; count: number }
interface AppAnswer {
  from: number; to: number; days: number[]; active: number[]; opens: number[];
  installs: number; identified: number; sent: number; replies: number; latencyMs: number | null;
  screens: CountRow[]; features: CountRow[]; errors: CountRow[]; pairFailures: CountRow[]; platforms: CountRow[]; versions: CountRow[];
}

function RankedList({ title, rows, features = false }: { title: string; rows: CountRow[]; features?: boolean }) {
  const max = Math.max(1, ...rows.map((row) => row.count));
  return (
    <Section title={title} className="!mt-0 min-w-0">
      {rows.length ? (
        <ol className="divide-y divide-line">
          {rows.map((row) => (
            <li key={row.key} className="relative flex min-h-12 items-center justify-between gap-3 py-3 text-14">
              <span className="truncate text-ink-2" title={row.key}>{features ? row.key.replace(/_/g, " ") : row.key}</span>
              <span className="shrink-0 font-mono text-ink num">{n(row.count)}</span>
              <span className="absolute bottom-1 left-0 h-1 rounded-full bg-accent/10" style={{ width: `${row.count / max * 100}%` }} aria-hidden />
            </li>
          ))}
        </ol>
      ) : <p className="text-14 text-ink-3">nothing yet.</p>}
    </Section>
  );
}

export function AppUsagePage({ tabs }: { tabs?: ReactNode }) {
  const [range, setRange] = useState<Range>(() => rangeOf("30d"));
  const { data, error, loading, reload } = useAdmin<AppAnswer>(`/app?from=${range.from}&to=${range.to}`);
  const screens = data?.screens.reduce((sum, row) => sum + row.count, 0) ?? 0;
  const errors = data?.errors.reduce((sum, row) => sum + row.count, 0) ?? 0;
  const days = data?.days.map(dayKey) ?? [];
  return (
    <>
      <AdminHeader title="product" sub="the desktop and phone apps: what gets used, never what is said" action={<RangePicker value={range} onChange={setRange} />} tabs={tabs} />
      {error && <Failed error={error} retry={reload} />}
      {!data && loading && <Loading />}
      {data && (
        <>
          <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-6">
            <Tile label="installs" value={n(data.installs)} note={`${n(data.identified)} signed in`} />
            <Tile label="messages sent" value={n(data.sent)} />
            <Tile label="bot replies" value={n(data.replies)} />
            <Tile label="median reply time" value={duration(data.latencyMs)} />
            <Tile label="screens viewed" value={n(screens)} />
            <Tile label="errors" value={n(errors)} tone={errors > 0 ? "bad" : undefined} />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-4 max-md:grid-cols-1">
            <div className="min-w-0 rounded-[18px] bg-card p-5"><DayBars title="people using an app" days={days} values={data.active} /></div>
            <div className="min-w-0 rounded-[18px] bg-card p-5"><DayBars title="app opens" days={days} values={data.opens} /></div>
          </div>
          <div className="mt-10 grid grid-cols-3 gap-x-8 gap-y-10 max-xl:grid-cols-2 max-md:grid-cols-1">
            <RankedList title="screens" rows={data.screens} />
            <RankedList title="features" rows={data.features} features />
            <RankedList title="errors" rows={data.errors} />
            <RankedList title="pairing failures" rows={data.pairFailures} />
            <RankedList title="platforms" rows={data.platforms} />
            <RankedList title="versions" rows={data.versions} />
          </div>
          <p className="mt-6 text-12 text-ink-4">counts only. message text, prompts and files never leave the app for this.</p>
        </>
      )}
    </>
  );
}
