import { useState } from "react";
import { Segmented, cx } from "../ui/kit";
import { useAdmin } from "./api";
import { AdminHeader, Failed, Loading, n } from "./ui";
import { RangePicker, percent, rangeOf, type Range } from "./kit";

interface Step { id: string; label: string; count: number; medianMs: number | null }
interface Drop { count: number; lastPages: Array<{ key: string; count: number }>; lastEvents: Array<{ key: string; count: number }>; scroll: number[] }
interface Answer { from: number; to: number; mode: "visitors" | "signups"; steps: Step[]; dropoff: Record<string, Drop>; bySource: Array<{ channel: string; counts: number[] }> }

const EVENT: Record<string, string> = { site_view: "a page view", cta_click: "clicked sign up", download_click: "clicked download", outbound: "left for another site", waitlist_join: "joined the waitlist",
  page_view: "an account page", onboarding_step: "an onboarding step", sign_in: "signing in", signup: "signing up", app_open: "opening the app" };
const CHANNEL: Record<string, string> = { ai: "ai assistants", referral: "referrals", unknown: "not tracked" };

export function FunnelPage() {
  const [range, setRange] = useState<Range>(() => rangeOf("30d"));
  const [mode, setMode] = useState<"visitors" | "signups">("visitors");
  const [channel, setChannel] = useState("all");
  const [picked, setPicked] = useState<string | null>(null);
  const { data, error, loading, reload } = useAdmin<Answer>(`/funnel?from=${range.from}&to=${range.to}&mode=${mode}`);
  const row = data?.bySource.find((r) => r.channel === channel);
  const counts = data ? (row ? row.counts : data.steps.map((step) => step.count)) : [];
  const first = Math.max(1, counts[0] ?? 1);
  const drops = data ? data.steps.slice(1).map((step, i) => ({ id: step.id, from: data.steps[i]!, i: i + 1, kept: counts[i] ? counts[i + 1]! / counts[i]! : null, lost: (counts[i] ?? 0) - (counts[i + 1] ?? 0) })) : [];
  const worst = [...drops].filter((d) => d.kept !== null && (counts[d.i - 1] ?? 0) >= 3).sort((a, b) => (a.kept ?? 1) - (b.kept ?? 1))[0];
  const open = drops.find((d) => d.id === picked) ?? worst ?? null;
  const reasons = open && channel === "all" ? data?.dropoff[open.from.id] : undefined;
  return (
    <>
      <AdminHeader title="funnel" sub={mode === "visitors" ? "from first visit to coming back" : "from signup to coming back"}
        action={<div className="flex flex-wrap items-center gap-2"><Segmented<"visitors" | "signups"> label="start from" value={mode} onChange={setMode} options={[{ value: "visitors", label: "from visitors" }, { value: "signups", label: "from signups" }]} /><RangePicker value={range} onChange={setRange} /></div>} />
      {error && <Failed error={error} retry={reload} />}
      {!data && loading && <Loading rows={6} />}
      {data && (
        <div className={cx(loading && "opacity-70")}>
          <div role="radiogroup" aria-label="channel" className="scroll-x mb-4 flex gap-1">
            {[{ channel: "all" }, ...data.bySource].map((r) => (
              <button key={r.channel} type="button" role="radio" aria-checked={channel === r.channel} onClick={() => setChannel(r.channel)}
                className={cx("h-8 shrink-0 rounded-full px-3.5 text-13", channel === r.channel ? "bg-primary text-primary-ink" : "bg-card text-ink-2 hover-link")}>{r.channel === "all" ? "every channel" : CHANNEL[r.channel] ?? r.channel}</button>
            ))}
          </div>
          <ol className="scroll-x flex items-stretch rounded-[28px] bg-card p-3" aria-label="funnel steps">
            {data.steps.map((step, i) => {
              const drop = drops[i - 1];
              const share = (counts[i] ?? 0) / first;
              return (
                <li key={step.id} className="flex shrink-0 items-stretch">
                  {drop && (
                    <button type="button" onClick={() => setPicked(drop.id)} aria-pressed={open?.id === drop.id} title={`${n(drop.lost)} dropped between these steps`}
                      className={cx("mx-0.5 flex w-[64px] flex-col items-center justify-center gap-1 rounded-[14px] text-center", open?.id === drop.id ? "bg-pop" : "hover-ghost")}>
                      <span className={cx("font-mono text-[15px] font-medium num", drop.kept === null ? "text-ink-4" : drop.kept >= 0.6 ? "text-good" : drop.kept >= 0.3 ? "text-warn" : "text-bad")}>{drop.kept === null ? "-" : percent(drop.kept)}</span>
                      <span className="text-[11px] leading-tight text-ink-4">kept</span>
                    </button>
                  )}
                  <div className="flex w-[118px] flex-col rounded-[18px] bg-pop p-3">
                    <span className="font-mono text-[26px] font-medium leading-8 tracking-[-0.045em] text-ink num">{n(counts[i] ?? 0)}</span>
                    <span className="mt-0.5 line-clamp-2 min-h-8 text-12 leading-4 text-ink-3">{step.label}</span>
                    <span className="mt-3 flex h-24 items-end overflow-hidden rounded-[10px] bg-track" aria-hidden>
                      <span className="block w-full rounded-[10px] bg-accent" style={{ height: `${Math.max(2, share * 100)}%`, opacity: 0.35 + 0.65 * share }} />
                    </span>
                    <span className="mt-2 font-mono text-[11.5px] text-ink-4 num">{percent(share)} of start</span>
                  </div>
                </li>
              );
            })}
          </ol>
          {open && (
            <section aria-label="why they dropped" className="mt-4 rounded-[24px] bg-card p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <h2 className="text-16 font-medium tracking-[-0.02em] text-ink"><span className="font-mono text-bad num">{n(open.lost)}</span> stopped after "{open.from.label}"</h2>
                <span className="text-12 text-ink-4">{open === worst ? "the biggest drop. " : ""}tap a % above to see another step</span>
              </div>
              {reasons ? (
                <div className="mt-4 grid grid-cols-3 gap-6 max-md:grid-cols-1">
                  <Tops title="last page" rows={reasons.lastPages} />
                  <Tops title="last thing they did" rows={reasons.lastEvents.map((r) => ({ ...r, key: EVENT[r.key] ?? r.key.replace(/_/g, " ") }))} />
                  <div>
                    <div className="t-meta mb-2">how far they scrolled</div>
                    {reasons.scroll.some(Boolean) ? (
                      <ul className="flex flex-col gap-1.5">
                        {["under 25%", "25 to 50%", "50 to 75%", "75% or more"].map((label, k) => {
                          const most = Math.max(1, ...reasons.scroll);
                          return <li key={label} className="grid grid-cols-[80px_minmax(0,1fr)_32px] items-center gap-2 text-13"><span className="text-ink-2">{label}</span><span className="h-1.5 overflow-hidden rounded-full bg-track"><span className="block h-full rounded-full bg-coral" style={{ width: `${((reasons.scroll[k] ?? 0) / most) * 100}%` }} /></span><span className="text-end font-mono num">{n(reasons.scroll[k] ?? 0)}</span></li>;
                        })}
                      </ul>
                    ) : <p className="text-13 text-ink-4">no scroll data.</p>}
                  </div>
                </div>
              ) : <p className="mt-3 text-13 text-ink-3">{channel === "all" ? "no details for this step." : "reasons show for every channel together."}</p>}
            </section>
          )}
          <p className="mt-4 text-12 text-ink-4">each step counts people who did every step before it. came back: used the account page or an app on day 1, in week 2, or in month 2.</p>
        </div>
      )}
    </>
  );
}

function Tops({ title, rows }: { title: string; rows: Array<{ key: string; count: number }> }) {
  return (
    <div>
      <div className="t-meta mb-2">{title}</div>
      {rows.length ? <ul className="flex flex-col gap-1">{rows.map((row) => <li key={row.key} className="flex items-center justify-between gap-3 text-13"><span className="min-w-0 truncate text-ink-2">{row.key}</span><span className="font-mono num">{n(row.count)}</span></li>)}</ul>
        : <p className="text-13 text-ink-4">not recorded.</p>}
    </div>
  );
}
