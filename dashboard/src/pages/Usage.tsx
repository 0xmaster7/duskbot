import { useMemo, useState } from "react";
import type { ActivityReport, BotReport } from "../../../shared/dashboard-protocol";
import { useSession } from "../data/session";
import { compact, dayKey, parseDay, plural, shortDate, usd } from "../lib/format";
import { Bar, Card, PageHeader, SectionTitle, Segmented, Stat } from "../ui/kit";
import { Heatmap, HeatStats, type HeatMetric } from "../ui/Heatmap";
import { BotMascot } from "../ui/Mascot";
import { WorkspaceGate } from "./common";
import { monthTotals } from "./Overview";

const DAY_MS = 86_400_000;
const measure = (row: { turns: number; tokens: number; costUsd: number | null }, metric: HeatMetric) =>
  metric === "turns" ? row.turns : metric === "tokens" ? row.tokens : row.costUsd ?? 0;
const say = (v: number, metric: HeatMetric) => (metric === "turns" ? v.toLocaleString("en-US") : metric === "tokens" ? compact(v) : usd(v));

function Breakdown({ title, rows, metric, bots }: { title: string; rows: Array<{ key: string; label: string; turns: number; tokens: number; costUsd: number | null }>; metric: HeatMetric; bots?: BotReport[] }) {
  const sorted = [...rows].sort((a, b) => measure(b, metric) - measure(a, metric)).slice(0, 8);
  const top = Math.max(1e-9, ...sorted.map((r) => measure(r, metric)));
  return (
    <Card>
      <SectionTitle>{title}</SectionTitle>
      {sorted.length ? (
        <ul className="flex flex-col gap-4">
          {sorted.map((r) => {
            const bot = bots?.find((b) => b.id === r.key);
            return (
              <li key={r.key}>
                <div className="flex items-center gap-2.5 text-14">
                  {bot && <BotMascot bot={bot} size={20} />}
                  <span className="min-w-0 flex-1 truncate text-ink">{r.label}</span>
                  <span className="num text-ink-2">{say(measure(r, metric), metric)}</span>
                </div>
                <Bar value={(measure(r, metric) / top) * 100} className="mt-2" label={`${r.label} share`} />
              </li>
            );
          })}
        </ul>
      ) : <p className="text-14 text-ink-3">Nothing yet this year.</p>}
    </Card>
  );
}

function Daily({ activity, metric, now }: { activity: ActivityReport; metric: HeatMetric; now: number }) {
  const days = useMemo(() => {
    const byDay = new Map(activity.days.map((d) => [d.date, d]));
    const today = parseDay(dayKey(now)).getTime();
    return Array.from({ length: 30 }, (_, i) => {
      const t = today - (29 - i) * DAY_MS;
      const d = byDay.get(dayKey(t));
      return { t, v: d ? measure(d, metric) : 0 };
    });
  }, [activity, metric, now]);
  const top = Math.max(1e-9, ...days.map((d) => d.v));
  return (
    <Card aria-labelledby="daily-title">
      <SectionTitle id="daily-title">Last 30 days</SectionTitle>
      <div className="flex h-36 items-end gap-[3px]" role="img" aria-label={`Daily ${metric} over the last 30 days`}>
        {days.map((d) => (
          <div key={d.t} className="flex h-full flex-1 items-end" title={`${shortDate(d.t)}: ${say(d.v, metric)}`}>
            <div className="w-full rounded-[3px]" style={{ height: `${Math.max(d.v ? 4 : 2, (d.v / top) * 100)}%`, background: d.v ? "var(--heat-4)" : "var(--cell)" }} />
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between text-12 text-ink-4" aria-hidden><span>{shortDate(days[0]!.t)}</span><span>Today</span></div>
    </Card>
  );
}

export function UsagePage() {
  const { now } = useSession();
  const [metric, setMetric] = useState<HeatMetric>("turns");
  return (
    <div>
      <PageHeader
        title="Usage"
        sub="Every finished bot turn on this workspace. Spend is estimated from each engine's token prices."
        action={<Segmented<HeatMetric> label="Measure" value={metric} onChange={setMetric} options={[{ value: "turns", label: "Turns" }, { value: "tokens", label: "Tokens" }, { value: "spend", label: "Spend" }]} />}
      />
      <WorkspaceGate>
        {(detail) => {
          const a = detail.report?.activity;
          if (!a) return <Card><p className="text-14 text-ink-3">This workspace has not sent its usage yet.</p></Card>;
          const month = monthTotals(a, now);
          return (
            <div className="flex flex-col gap-4">
              <Card>
                <div className="grid grid-cols-4 gap-6 max-md:grid-cols-2">
                  <Stat label="This month" value={metric === "turns" ? plural(month.turns, "turn") : metric === "tokens" ? `${compact(month.tokens)} tokens` : usd(month.costUsd ?? 0)} />
                  <Stat label="This year" value={say(measure(a.totals, metric), metric)} />
                  <Stat label="Bots active" value={a.byBot.filter((b) => b.turns > 0).length} />
                  <Stat label="Models used" value={a.byModel.length} />
                </div>
                <div className="mt-7"><Heatmap days={a.days} metric={metric} now={now} /></div>
                <div className="mt-7"><HeatStats days={a.days} metric={metric} now={now} /></div>
              </Card>
              <Daily activity={a} metric={metric} now={now} />
              <div className="grid gap-4 md:grid-cols-2">
                <Breakdown title="By bot" metric={metric} bots={detail.report?.bots} rows={a.byBot.map((b) => ({ key: b.botId, label: b.botName, turns: b.turns, tokens: b.tokens, costUsd: b.costUsd }))} />
                <Breakdown title="By model" metric={metric} rows={a.byModel.map((m) => ({ key: m.model, label: m.model || "Unknown model", turns: m.turns, tokens: m.tokens, costUsd: m.costUsd }))} />
              </div>
              <p className="px-1 text-13 text-ink-4">Receipts for single turns open from each chat in the app. Times are in {a.timeZone}.</p>
            </div>
          );
        }}
      </WorkspaceGate>
    </div>
  );
}
