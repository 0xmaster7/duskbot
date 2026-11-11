import { useState } from "react";
import { Button, cx } from "../ui/kit";
import { adminCall, useAdmin } from "./api";
import { countryName } from "./geo";
import { AdminHeader, Failed, Loading, n } from "./ui";
import { Delta, DualChart, FilterChips, NoteDialog, RangePicker, RankCard, duration, percent, rangeOf, type Note, type Range, type RankRow, type SeriesData } from "./kit";

interface Kpis { visitors: number; visits: number; pageviews: number; signups: number; paid: number; waitlist: number; conversion: number | null; bounce: number | null; visitMs: number | null }
export interface WebAnswer {
  from: number; to: number; now: number; filters: Record<string, string>; current: Kpis; previous: Kpis; online: { site: number; app: number };
  series: SeriesData; cards: Record<string, RankRow[]>; notes: Note[]; tracked: boolean;
  crawlers: { total: number; bot: RankRow[]; page: RankRow[]; kind: RankRow[] };
}

const CHANNEL: Record<string, string> = { direct: "direct", search: "search", social: "social", ai: "ai assistants", referral: "referrals", email: "email", paid: "paid", unknown: "unknown" };
const label = (tab: string, key: string) => tab === "channel" ? CHANNEL[key] ?? key : tab === "country" ? countryName(key) : key === "unknown" ? "unknown" : key;

function query(range: Range, filters: Record<string, string | undefined>) {
  const params = new URLSearchParams({ from: String(range.from), to: String(range.to) });
  for (const [dim, value] of Object.entries(filters)) if (value !== undefined) params.set(`f.${dim}`, value);
  return params.toString();
}

export function SitePage() {
  const [range, setRange] = useState<Range>(() => rangeOf("30d"));
  const [filters, setFilters] = useState<Record<string, string | undefined>>({});
  const [show, setShow] = useState({ visitors: true, signups: true, paid: true });
  const [note, setNote] = useState<Note | { at: number } | null>(null);
  const { data, error, loading, reload } = useAdmin<WebAnswer>(`/web?${query(range, filters)}`, 60_000);
  const pick = (dim: string, key: string) => setFilters((current) => ({ ...current, [dim]: current[dim] === key ? undefined : key }));
  const c = data?.current, p = data?.previous;
  const kpis: Array<{ id: keyof typeof show | null; label: string; value: string; now: number | null; before: number | null; invert?: boolean; note?: string }> = c && p ? [
    { id: "visitors", label: "visitors", value: n(c.visitors), now: c.visitors, before: p.visitors },
    { id: "signups", label: "signups", value: n(c.signups), now: c.signups, before: p.signups },
    { id: null, label: "signed up", value: percent(c.conversion), now: c.conversion, before: p.conversion, note: "of visitors" },
    { id: "paid", label: "paid", value: n(c.paid), now: c.paid, before: p.paid, note: c.paid || p.paid ? undefined : "checkout opens soon" },
    { id: null, label: "bounce", value: percent(c.bounce), now: c.bounce, before: p.bounce, invert: true },
    { id: null, label: "visit time", value: duration(c.visitMs), now: c.visitMs, before: p.visitMs, note: "median" },
  ] : [];
  return (
    <>
      <AdminHeader title="analytics" sub="the site, who signs up, and where they came from" action={<RangePicker value={range} onChange={setRange} />} />
      <FilterChips filters={filters} onRemove={(dim) => setFilters((current) => ({ ...current, [dim]: undefined }))} label={label} />
      {error && <Failed error={error} retry={reload} />}
      {!data && loading && <Loading rows={8} />}
      {data && c && (
        <>
          {!data.tracked && (
            <p className="mb-4 rounded-[18px] bg-lemon px-4 py-3 text-14 text-ink">no site visits recorded yet. the site sends them once its pages carry the tracker (a.js); visits from this browser are never counted while you're signed in as admin.</p>
          )}
          <section className="rounded-[28px] bg-card p-2" aria-label="key numbers and chart">
            <div className="grid grid-cols-7 gap-px overflow-hidden rounded-[22px] bg-line max-xl:grid-cols-4 max-sm:grid-cols-2">
              {kpis.map((kpi) => {
                const toggle = kpi.id;
                return (
                  <div key={kpi.label} className="min-w-0 bg-pop px-4 py-3.5">
                    {toggle ? (
                      <label className="flex cursor-pointer items-center gap-2 text-13 text-ink-3">
                        <input type="checkbox" checked={show[toggle]} onChange={() => setShow((s) => ({ ...s, [toggle]: !s[toggle] }))} className="size-3.5 accent-[var(--accent)]" />
                        {kpi.label}
                      </label>
                    ) : <div className="text-13 text-ink-3">{kpi.label}</div>}
                    <div className="mt-1 truncate font-mono text-[26px] font-medium leading-8 tracking-[-0.04em] text-ink num">{kpi.value}</div>
                    <div className="mt-0.5 truncate">{kpi.note ? <span className="text-12 text-ink-4">{kpi.note} · </span> : null}<Delta now={kpi.now} before={kpi.before} invert={kpi.invert} /></div>
                  </div>
                );
              })}
              <div className="min-w-0 bg-pop px-4 py-3.5 max-xl:col-span-2">
                <div className="flex items-center gap-2 text-13 text-ink-3"><span className="live-dot text-good" data-live={data.online.site > 0} aria-hidden /> online now</div>
                <div className="mt-1 font-mono text-[26px] font-medium leading-8 tracking-[-0.04em] text-ink num">{n(data.online.site)}</div>
                <div className="mt-0.5 text-12 text-ink-4">{n(data.online.app)} in the apps</div>
              </div>
            </div>
            <div className="px-3 pb-2 pt-5 max-sm:px-1">
              <DualChart data={data.series} notes={data.notes} show={show} onNote={setNote} />
              <div className="mt-6 flex flex-wrap items-center justify-between gap-3 px-1">
                <div className="flex flex-wrap gap-4 text-12 text-ink-3" aria-hidden>
                  <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 rounded-full bg-accent" /> visitors</span>
                  <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-[2px] bg-ink" /> signups</span>
                  <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-[2px] bg-good" /> paid</span>
                  <span className="inline-flex items-center gap-1.5"><span className="size-2 rotate-45 rounded-[2px] bg-warn" /> notes</span>
                </div>
                <Button size="sm" onClick={() => setNote({ at: Date.now() })}>add a note</Button>
              </div>
            </div>
          </section>

          <div className={cx("mt-4 grid grid-cols-2 gap-4 max-lg:grid-cols-1", loading && "opacity-70")}>
            <RankCard title="where they came from" tabs={[{ id: "channel", label: "channel" }, { id: "source", label: "source" }, { id: "referrer", label: "referrer" }, { id: "campaign", label: "campaign" }, { id: "ref", label: "ref" }]}
              data={data.cards} label={label} onPick={pick} active={filters} />
            <RankCard title="pages" tabs={[{ id: "page", label: "page" }, { id: "entry", label: "entry" }, { id: "exit", label: "exit" }, { id: "goal", label: "goals" }]} data={data.cards} label={label} onPick={pick} active={filters} />
            <RankCard title="where they are" tabs={[{ id: "country", label: "country" }, { id: "region", label: "region" }, { id: "city", label: "city" }]} data={data.cards} label={label} onPick={pick} active={filters} />
            <RankCard title="what they use" tabs={[{ id: "browser", label: "browser" }, { id: "os", label: "os" }, { id: "device", label: "device" }]} data={data.cards} label={label} onPick={pick} active={filters} />
            <RankCard title={`ai crawlers, ${n(data.crawlers.total)} requests`} metric="requests" tabs={[{ id: "bot", label: "ai crawlers" }, { id: "page", label: "pages they read" }, { id: "kind", label: "why" }]}
              data={{ bot: data.crawlers.bot, page: data.crawlers.page, kind: data.crawlers.kind }} label={(tab, key) => tab === "kind" ? ({ answers: "answering someone now", indexing: "indexing for search", training: "collecting for training" })[key] ?? key : key} />
          </div>
          <p className="mt-4 text-12 text-ink-4">a row filters every number above. signups count people whose site visits are linked to their account; someone who signed up on another device shows as direct.</p>
        </>
      )}
      <NoteDialog key={note ? ("id" in note ? note.id : "new") : "closed"} note={note} onClose={() => setNote(null)}
        onSave={async (input) => { await adminCall(note && "id" in note ? `/notes/${note.id}` : "/notes", { method: note && "id" in note ? "PATCH" : "POST", body: input }); reload(); }}
        onDelete={async (id) => { await adminCall(`/notes/${id}`, { method: "DELETE", body: {} }); reload(); }} />
    </>
  );
}
