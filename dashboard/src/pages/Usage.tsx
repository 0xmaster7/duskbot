import { useMemo, useState } from "react";
import { Ban, ChevronLeft, ChevronRight, Copy, Download, ExternalLink, X } from "lucide-react";
import { categoryLabel } from "../data/fixtures";
import { useStore } from "../data/store";
import type { Category, Coverage, Turn } from "../data/types";
import { compact, date, dateLong, dayKey, duration, fromDayKey, hours, int, monthName, usd, usdTiny } from "../lib/format";
import { setQuery, useLocation } from "../lib/router";
import { addDays, billedValue, daily, download, emptySplit, filterTurns, forecast, groupTurns, sourceLabel, splitOf, startOfDay, toCsv, turnPaid, type GroupBy } from "../lib/usage";
import { StackedBars } from "../ui/charts";
import { Button, Card, CardHead, CoverageTag, coverageLabel, cx, FilterSelect, IconButton, PageHead, Pill, Segmented, StatusTag, STROKE } from "../ui/kit";
import { BotMark, EmptyState } from "../ui/Mascot";
import { Drawer, Menu } from "../ui/overlays";

const DAY = 86_400_000;
const CAT_COLORS: Record<Category, string> = { ai: "#0077e6", computer: "#519dfa", voice: "#8dbdf8", research: "#c4dcf9", machine: "#dfe9f5" };
const CATS: Category[] = ["ai", "computer", "voice", "research"];
type Range = "period" | "7" | "30" | "90" | "custom";

function useRange(now: number, periodStart: number, periodEnd: number, q: URLSearchParams) {
  const from = q.get("from"), to = q.get("to");
  if (from && to && /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return { range: "custom" as Range, start: fromDayKey(from), end: addDays(fromDayKey(to), 1) };
  }
  const r = (q.get("range") ?? "period") as Range;
  const today = startOfDay(now);
  if (r === "7" || r === "30" || r === "90") return { range: r, start: addDays(today, -Number(r) + 1), end: addDays(today, 1) };
  return { range: "period" as Range, start: periodStart, end: periodEnd };
}

function Delta({ now, before }: { now: number; before: number }) {
  if (before <= 0.005) return null;
  const change = Math.round(((now - before) / before) * 100);
  return <span className={cx("num text-12", change > 0 ? "text-ink-3" : "text-good")}>{change > 0 ? "+" : ""}{change}%</span>;
}

function Receipt({ turn, onClose }: { turn: Turn | null; onClose: () => void }) {
  const { data, toast } = useStore();
  const bot = turn ? data.bots.find((b) => b.id === turn.botId) : null;
  const split = turn ? splitOf(turn) : emptySplit();
  return (
    <Drawer open={!!turn} onClose={onClose} title={turn?.title ?? ""}
      footer={turn && <>
        <Button variant="primary" icon={ExternalLink} onClick={() => { window.location.href = `openmausbot://thread/${turn.threadId}`; }}>Open conversation</Button>
        <Button icon={Copy} onClick={() => { void navigator.clipboard?.writeText(turn.id); toast("Receipt ID copied"); }}>Copy ID</Button>
      </>}>
      {turn && bot && (
        <div className="flex flex-col gap-5">
          <div className="flex items-center gap-3">
            <BotMark bot={bot} size={32} />
            <div className="min-w-0 flex-1">
              <p className="text-14 font-medium">{bot.name}</p>
              <p className="text-12 text-ink-3">{dateLong(turn.at)}, {new Date(turn.at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</p>
            </div>
            {turn.status === "ok" ? <Pill tone="good" dot>Finished</Pill> : <Pill tone="bad" dot>{turn.status === "failed" ? "Failed" : "Cancelled"}</Pill>}
          </div>
          {turn.status !== "ok" && (
            <p className="flex items-start gap-2 rounded-[10px] bg-sunk px-3 py-2.5 text-13 text-ink-2"><Ban size={15} strokeWidth={STROKE} className="mt-0.5 shrink-0" aria-hidden />Not charged. This turn {turn.status === "failed" ? "failed" : "was cancelled"} before it produced an answer, so every line below is zero.</p>
          )}
          <div>
            <p className="mb-1 text-12 font-medium text-ink-3">What it cost</p>
            <table className="w-full text-13">
              <tbody>
                {turn.lines.map((l, i) => (
                  <tr key={i} className="border-b border-row">
                    <td className="h-10">{categoryLabel[l.category]}{l.estimated && <span className="ms-1.5 text-12 text-ink-4">estimated</span>}</td>
                    <td className="text-end"><CoverageTag coverage={l.coverage} /></td>
                    <td className={cx("num w-20 text-end", l.coverage === "own" ? "text-ink-4" : "font-medium")}>{l.coverage === "own" ? "~" : ""}{usdTiny(l.usd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <dl className="mt-3 flex flex-col gap-1 text-13">
              <div className="flex justify-between"><dt className="font-medium">Charged to your balance</dt><dd className="num font-medium">{usd(split.paid)}</dd></div>
              {split.included + split.trial > 0 && <div className="flex justify-between text-ink-3"><dt>Covered by your plan and trial</dt><dd className="num">{usdTiny(split.included + split.trial)}</dd></div>}
              {split.own > 0 && <div className="flex justify-between text-ink-3"><dt>On your own subscription, not billed</dt><dd className="num">~{usdTiny(split.own)}</dd></div>}
            </dl>
          </div>
          <div>
            <p className="mb-1 text-12 font-medium text-ink-3">What it did</p>
            <dl className="grid grid-cols-2 gap-x-6 text-13">
              {([
                ["Started from", sourceLabel[turn.source]], ["Model", turn.model || "Unknown"], ["Took", duration(turn.durationMs)], ["Tool calls", int(turn.tools)],
                ["Input tokens", int(turn.input)], ["Of which cached", int(turn.cached)], ["Output tokens", int(turn.output)], ["Computer time", turn.computerMinutes ? `${turn.computerMinutes} min` : "None"],
                ...(turn.voiceChars ? [["Voice", `${int(turn.voiceChars)} characters`]] : []),
              ] as Array<[string, string]>).map(([k, v]) => (
                <div key={k} className="flex h-9 items-center justify-between gap-2 border-b border-row"><dt className="text-ink-3">{k}</dt><dd className="num truncate font-medium">{v}</dd></div>
              ))}
            </dl>
          </div>
          <p className="font-mono text-12 text-ink-4">{turn.id}, thread {turn.threadId}</p>
        </div>
      )}
    </Drawer>
  );
}

const PAGE = 25;

export function UsagePage() {
  const { data, toast } = useStore();
  const { query } = useLocation();
  const { range, start, end } = useRange(data.now, data.billing.periodStart, data.billing.periodEnd, query);
  const botId = query.get("bot") ?? "";
  const category = (query.get("category") ?? "") as Category | "";
  const coverage = (query.get("coverage") ?? "") as Coverage | "";
  const status = (query.get("status") ?? "") as Turn["status"] | "";
  const group = (query.get("group") ?? "bot") as GroupBy;
  const utc = query.get("tz") === "utc";
  const [page, setPage] = useState(0);
  const openId = query.get("turn");

  const turns = useMemo(() => filterTurns(data.turns, { from: start, to: end, botId: botId || undefined, category: category || undefined, coverage: coverage || undefined, status: status || undefined }), [data.turns, start, end, botId, category, coverage, status]);
  const span = Math.min(end, data.now) - start;
  const before = useMemo(() => filterTurns(data.turns, { from: start - span, to: start, botId: botId || undefined, category: category || undefined, coverage: coverage || undefined, status: status || undefined }), [data.turns, start, span, botId, category, coverage, status]);
  const split = useMemo(() => turns.reduce((s, t) => splitOf(t, s), emptySplit()), [turns]);
  const prevSplit = useMemo(() => before.reduce((s, t) => splitOf(t, s), emptySplit()), [before]);
  const chartEnd = Math.min(end, addDays(startOfDay(data.now), 1));
  const days = useMemo(() => daily(turns, start, chartEnd), [turns, start, chartEnd]);
  const isPeriod = range === "period";
  const f = useMemo(() => forecast(turns, data.bots, data.now, start, end), [turns, data.bots, data.now, start, end]);
  const groups = useMemo(() => groupTurns(turns, group, data.bots), [turns, group, data.bots]);
  const ok = turns.filter((t) => t.status === "ok").length;
  const minutes = turns.reduce((s, t) => s + t.computerMinutes, 0);
  const shownTurn = openId ? data.turns.find((t) => t.id === openId) ?? null : null;

  let running = 0;
  const cumulative = days.map((d) => (running += d.paid));
  const fullDays = isPeriod ? Math.round((end - start) / DAY) : days.length;
  const forecastLine = isPeriod ? Array.from({ length: fullDays }, (_, i) => (i < days.length ? cumulative[i]! : cumulative[days.length - 1]! + f.perDay * (i - days.length + 1))) : undefined;
  const labels = days.map((d) => (days.length > 40 ? `${monthName(d.t)} ${new Date(d.t).getDate()}` : String(new Date(d.t).getDate())));

  const pages = Math.max(1, Math.ceil(turns.length / PAGE));
  const at = Math.min(page, pages - 1);
  const rows = turns.slice(at * PAGE, at * PAGE + PAGE);
  const name = (id: string) => data.bots.find((b) => b.id === id)!;
  const fmtTime = (t: number) => new Date(t).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", ...(utc ? { timeZone: "UTC" } : {}) });
  const filtered = botId || category || coverage || status || range === "custom";
  const stamp = `${dayKey(start)}-to-${dayKey(end - 1)}`;

  return (
    <>
      <PageHead title="Usage" sub="Every turn your bots finished, what it cost and who paid for it.">
        <Menu label="Export" trigger={(p) => <Button icon={Download} {...p}>Export</Button>} items={[
          { label: "CSV for this view", onSelect: () => { download(`usage-${stamp}.csv`, toCsv(turns, data.bots), "text/csv"); toast(`Exported ${int(turns.length)} turns as CSV`); } },
          { label: "JSON for this view", onSelect: () => { download(`usage-${stamp}.json`, JSON.stringify({ from: dayKey(start), to: dayKey(end - 1), turns }, null, 2), "application/json"); toast(`Exported ${int(turns.length)} turns as JSON`); } },
        ]} />
      </PageHead>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Segmented label="Date range" value={range === "custom" ? ("" as Range) : range} onChange={(r) => { setPage(0); setQuery({ range: r === "period" ? null : r, from: null, to: null }); }}
          options={[{ value: "period", label: "This month" }, { value: "7", label: "7 days" }, { value: "30", label: "30 days" }, { value: "90", label: "90 days" }]} />
        {range === "custom" && (
          <span className="inline-flex h-7 items-center gap-1 rounded-full bg-accent-wash pe-1 ps-2.5 text-13 font-medium text-accent-ink">
            {date(start)}{end - start > DAY && <> to {date(end - DAY)}</>}
            <button type="button" aria-label="Clear date filter" onClick={() => setQuery({ from: null, to: null })} className="inline-flex size-5 items-center justify-center rounded-full hover:bg-accent-4"><X size={12} strokeWidth={2} aria-hidden /></button>
          </span>
        )}
        <FilterSelect label="Bot" value={botId} onChange={(v) => { setPage(0); setQuery({ bot: v }); }} options={[{ value: "", label: "All" }, ...data.bots.map((b) => ({ value: b.id, label: b.name }))]} />
        <FilterSelect label="Kind" value={category} onChange={(v) => { setPage(0); setQuery({ category: v }); }} options={[{ value: "", label: "All" }, ...CATS.map((c) => ({ value: c, label: categoryLabel[c] }))]} />
        <FilterSelect label="Paid by" value={coverage} onChange={(v) => { setPage(0); setQuery({ coverage: v }); }} options={[{ value: "", label: "Anyone" }, ...(["paid", "included", "trial", "own"] as Coverage[]).map((c) => ({ value: c, label: coverageLabel[c] }))]} />
        <FilterSelect label="Status" value={status} onChange={(v) => { setPage(0); setQuery({ status: v }); }} options={[{ value: "", label: "All" }, { value: "ok", label: "Finished" }, { value: "failed", label: "Failed" }, { value: "cancelled", label: "Cancelled" }]} />
        {filtered && <Button size="sm" variant="ghost" onClick={() => setQuery({ bot: null, category: null, coverage: null, status: null, from: null, to: null })}>Clear</Button>}
      </div>

      <Card className="grid grid-cols-2 divide-line sm:grid-cols-3 lg:grid-cols-5 lg:divide-x">
        {[
          { label: "Paid", value: usd(split.paid), delta: <Delta now={split.paid} before={prevSplit.paid} />, note: "from your balance" },
          { label: "Included and trial", value: usd(split.included + split.trial), note: "covered by Pro" },
          { label: "Your own", value: `~${usd(split.own)}`, note: "not billed", muted: true },
          { label: "Turns", value: int(ok), delta: <Delta now={ok} before={before.filter((t) => t.status === "ok").length} />, note: `${turns.length - ok} not charged` },
          isPeriod ? { label: "Forecast", value: `${usdShortRange(f.low, f.high)}`, note: f.driver ? `driver: ${f.driver}` : "at this pace" } : { label: "Computer time", value: hours(minutes / 60), note: "included" },
        ].map((s) => (
          <div key={s.label} className="min-w-0 px-4 py-3.5">
            <p className="text-13 text-ink-3">{s.label}</p>
            <p className="mt-0.5 flex items-baseline gap-2"><span className={cx("num truncate text-18 font-semibold", s.muted && "text-ink-4")}>{s.value}</span>{s.delta}</p>
            <p className="truncate text-12 text-ink-4">{s.note}</p>
          </div>
        ))}
      </Card>

      <Card className="mt-4">
        <CardHead title="Daily cost">
          <div className="hidden flex-wrap items-center gap-3 text-12 text-ink-3 sm:flex" aria-hidden>
            {CATS.map((c) => <span key={c} className="inline-flex items-center gap-1.5"><span className="size-2 rounded-[2px]" style={{ background: CAT_COLORS[c] }} />{categoryLabel[c]}</span>)}
            <span className="inline-flex items-center gap-1.5"><span className="h-px w-3 bg-ink" />Paid so far</span>
            {isPeriod && <span className="inline-flex items-center gap-1.5"><span className="w-3 border-t border-dotted border-ink" />Forecast</span>}
          </div>
        </CardHead>
        <div className="px-2 pb-3 pt-1 sm:px-4">
          {turns.length === 0
            ? <EmptyState title="No turns in this view" state="sleeping">Nothing matches these filters. Widen the dates or clear a filter.</EmptyState>
            : <StackedBars keys={CATS.map((c) => ({ key: c, label: categoryLabel[c], color: CAT_COLORS[c] }))} rows={days.map((d) => d.byCategory)} labels={labels}
                line={cumulative} lineLabel="Paid so far" forecast={forecastLine} cap={isPeriod && !botId ? data.billing.caps.ai.limitUsd : undefined} capLabel={`AI cap ${usd(data.billing.caps.ai.limitUsd)}`}
                format={(v) => (v >= 10 ? `$${Math.round(v)}` : `$${v.toFixed(v >= 1 ? 1 : 2)}`)} label={`Daily cost from ${date(start)}, with paid spend so far as a line`}
                onPick={(i) => setQuery({ from: days[i]!.key, to: days[i]!.key, range: null })} />}
          {isPeriod && !botId && f.high > data.billing.caps.ai.limitUsd && (
            <p className="mx-2 mt-2 rounded-[10px] bg-warn-wash px-3 py-2 text-13 text-[#6b4800]">At this pace paid AI could reach your {usd(data.billing.caps.ai.limitUsd)} cap before the month ends{f.driver ? `, mostly from ${f.driver}` : ""}. Raise the cap in Billing or set a cap on that bot.</p>
          )}
          <p className="px-2 pt-2 text-12 text-ink-4">Bars show plan, trial and paid cost; your own subscriptions are left out. Click a day to see only its turns. Checked before each turn starts: a turn already running finishes, and any small overage is on us.</p>
        </div>
      </Card>

      <Card className="mt-4">
        <CardHead title="Breakdown">
          <FilterSelect label="By" value={group} onChange={(v) => setQuery({ group: v === "bot" ? null : v })} options={[{ value: "bot", label: "Bot" }, { value: "model", label: "Model" }, { value: "category", label: "Kind" }, { value: "source", label: "Started from" }, { value: "day", label: "Day" }]} />
        </CardHead>
        <div className="scroll-x">
          <table className="w-full min-w-[640px] text-13">
            <thead><tr className="h-9 border-b border-row text-12 text-ink-3">
              <th className="ps-4 text-start font-normal">{({ bot: "Bot", model: "Model", category: "Kind", source: "Started from", day: "Day" })[group]}</th>
              <th className="text-end font-normal">Turns</th><th className="text-end font-normal">Tokens</th><th className="text-end font-normal">Computer</th>
              <th className="text-end font-normal">Paid</th><th className="text-end font-normal">Plan and trial</th><th className="text-end font-normal">Your own</th><th className="w-36 pe-4 text-end font-normal">Share</th>
            </tr></thead>
            <tbody>
              {groups.slice(0, group === "day" ? 31 : 20).map((g) => (
                <tr key={g.key} className="h-10 border-b border-row last:border-0 hover:bg-hover">
                  <td className="ps-4 font-medium">{group === "day" ? date(fromDayKey(g.key)) : g.label}</td>
                  <td className="num text-end text-ink-2">{int(g.turns)}</td>
                  <td className="num text-end text-ink-2">{compact(g.tokens)}</td>
                  <td className="num text-end text-ink-2">{g.computerMinutes ? hours(g.computerMinutes / 60) : "None"}</td>
                  <td className="num text-end font-medium">{usd(g.split.paid)}</td>
                  <td className="num text-end text-ink-2">{usd(g.split.included + g.split.trial)}</td>
                  <td className="num text-end text-ink-4">~{usd(g.split.own)}</td>
                  <td className="pe-4"><span className="ms-auto flex w-28 items-center gap-2"><span className="h-1.5 flex-1 overflow-hidden rounded-full bg-track"><span className="block h-full rounded-full bg-accent-2" style={{ width: `${Math.round(g.share * 100)}%` }} /></span><span className="num w-8 text-end text-12 text-ink-3">{Math.round(g.share * 100)}%</span></span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="mt-4">
        <CardHead title="Turns">
          <Segmented size="sm" label="Times shown in" value={utc ? "utc" : "local"} onChange={(v) => setQuery({ tz: v === "utc" ? "utc" : null })} options={[{ value: "local", label: "Local" }, { value: "utc", label: "UTC" }]} />
        </CardHead>
        {rows.length === 0 ? <EmptyState title="No turns to show" state="sleeping">Try a wider date range.</EmptyState> : (
          <ul>
            <li className="hidden h-9 grid-cols-[110px_minmax(0,1fr)_84px_90px_72px_96px] items-center gap-3 border-y border-row px-4 text-12 text-ink-3 md:grid" aria-hidden>
              <span>Time</span><span>Turn</span><span>From</span><span className="text-end">Tokens</span><span className="text-end">Cost</span><span className="text-end">Paid by</span>
            </li>
            {rows.map((t) => {
              const s = splitOf(t);
              const cov: Coverage = s.paid ? "paid" : s.trial ? "trial" : s.own ? "own" : "included";
              const bot = name(t.botId);
              return (
                <li key={t.id} className="border-b border-row last:border-0">
                  <button type="button" onClick={() => setQuery({ turn: t.id })} aria-label={`Receipt: ${bot.name}, ${t.title}`}
                    className="grid min-h-11 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 px-4 py-2 text-start text-13 hover:bg-hover md:grid-cols-[110px_minmax(0,1fr)_84px_90px_72px_96px] md:py-0">
                    <span className="num order-2 text-12 text-ink-3 md:order-none md:text-13">{fmtTime(t.at)}</span>
                    <span className="flex min-w-0 items-center gap-2"><BotMark bot={bot} size={18} /><span className="truncate"><span className="font-medium">{bot.name}</span><span className="text-ink-3">, {t.title}</span></span></span>
                    <span className="hidden text-ink-2 md:block">{sourceLabel[t.source]}</span>
                    <span className="num hidden text-end text-ink-2 md:block">{compact(t.input + t.output)}</span>
                    <span className={cx("num text-end", cov === "own" ? "text-ink-4" : "font-medium")}>{t.status !== "ok" ? usd(0) : `${cov === "own" ? "~" : ""}${usdTiny(cov === "own" ? s.own : billedValue(s))}`}</span>
                    <span className="order-3 flex justify-end md:order-none">{t.status !== "ok" ? <StatusTag status={t.status} /> : <CoverageTag coverage={cov} />}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <div className="flex items-center gap-2 border-t border-row px-4 py-2 text-12 text-ink-3">
          <span className="num">{int(turns.length)} turns{turns.length > PAGE && `, page ${at + 1} of ${pages}`}</span>
          <span className="ms-auto flex gap-1">
            <IconButton label="Previous page" icon={ChevronLeft} disabled={at === 0} onClick={() => setPage(at - 1)} className="disabled:opacity-40" />
            <IconButton label="Next page" icon={ChevronRight} disabled={at >= pages - 1} onClick={() => setPage(at + 1)} className="disabled:opacity-40" />
          </span>
        </div>
      </Card>
      <p className="mt-4 text-12 text-ink-3">Failed and cancelled turns stay listed and are never charged. Prices per unit are on the <a href="https://openmausbot.com/pricing" className="font-medium text-ink underline-offset-2 hover:underline">price list</a>. Paid AI so far this month: {usd(data.turns.filter((t) => t.at >= data.billing.periodStart).reduce((s, t) => s + turnPaid(t), 0))}.</p>
      <Receipt turn={shownTurn} onClose={() => setQuery({ turn: null })} />
    </>
  );
}

function usdShortRange(low: number, high: number) {
  return `$${Math.round(low)} to $${Math.round(high)}`;
}
