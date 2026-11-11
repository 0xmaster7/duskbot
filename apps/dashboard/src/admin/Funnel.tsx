import { useState } from "react";
import { ChevronDown } from "@/icons";
import { Segmented, cx } from "../ui/kit";
import { Table, Td, Th } from "../ui/table";
import { useAdmin } from "./api";
import { AdminHeader, Failed, Loading, n } from "./ui";
import { RangePicker, duration, rangeOf, type Range } from "./kit";

interface Step { id: string; label: string; count: number; medianMs: number | null }
interface Drop { count: number; lastPages: Array<{ key: string; count: number }>; lastEvents: Array<{ key: string; count: number }>; scroll: number[] }
interface Answer { from: number; to: number; mode: "visitors" | "signups"; steps: Step[]; dropoff: Record<string, Drop>; bySource: Array<{ channel: string; counts: number[] }> }

const EVENT: Record<string, string> = { site_view: "a page view", cta_click: "clicked sign up", download_click: "clicked download", outbound: "left for another site", waitlist_join: "joined the waitlist",
  page_view: "an account page", onboarding_step: "an onboarding step", sign_in: "signing in", signup: "signing up", app_open: "opening the app" };
const CHANNEL: Record<string, string> = { ai: "ai assistants", referral: "referrals", unknown: "not tracked" };

export function FunnelPage() {
  const [range, setRange] = useState<Range>(() => rangeOf("30d"));
  const [mode, setMode] = useState<"visitors" | "signups">("visitors");
  const [open, setOpen] = useState<string | null>(null);
  const { data, error, loading, reload } = useAdmin<Answer>(`/funnel?from=${range.from}&to=${range.to}&mode=${mode}`);
  const first = data?.steps[0]?.count ?? 0;
  return (
    <>
      <AdminHeader title="funnel" sub={mode === "visitors" ? "everyone who first visited in the window, and how far they got" : "everyone who signed up in the window, and how far they got"}
        action={<div className="flex flex-wrap items-center gap-2"><Segmented<"visitors" | "signups"> label="start from" value={mode} onChange={setMode} options={[{ value: "visitors", label: "from visitors" }, { value: "signups", label: "from signups" }]} /><RangePicker value={range} onChange={setRange} /></div>} />
      {error && <Failed error={error} retry={reload} />}
      {!data && loading && <Loading rows={10} />}
      {data && (
        <>
          <ol className={cx("flex flex-col gap-1.5", loading && "opacity-70")} aria-label="funnel steps">
            {data.steps.map((step, i) => {
              const prev = data.steps[i - 1], lost = prev ? prev.count - step.count : 0, drop = prev ? data.dropoff[prev.id] : undefined;
              const expanded = open === step.id;
              return (
                <li key={step.id} className="rounded-[18px] bg-card">
                  <div className="grid grid-cols-[28px_minmax(0,1fr)_minmax(0,2fr)_88px_120px] items-center gap-4 px-4 py-3 max-md:grid-cols-[28px_minmax(0,1fr)_72px] max-md:gap-y-2">
                    <span className="font-mono text-12 text-ink-4">{String(i + 1).padStart(2, "0")}</span>
                    <span className="min-w-0 truncate text-14 text-ink">{step.label}</span>
                    <span className="relative h-7 overflow-hidden rounded-[8px] bg-pop max-md:order-last max-md:col-span-3" aria-hidden>
                      <span className="bar-fill absolute inset-y-0 left-0 w-full rounded-[8px] bg-accent" style={{ transform: `scaleX(${first ? step.count / first : 0})`, opacity: 0.25 + 0.75 * (first ? step.count / first : 0) }} />
                    </span>
                    <span className="text-end font-mono text-[18px] font-medium text-ink num">{n(step.count)}</span>
                    <span className="text-end text-12 text-ink-3 max-md:hidden">
                      {prev ? <>{prev.count ? `${Math.round((step.count / prev.count) * 100)}%` : "-"} of step {i}{step.medianMs !== null ? <span className="block text-ink-4">median {duration(step.medianMs)}</span> : null}</> : "start"}
                    </span>
                  </div>
                  {prev && lost > 0 && drop && (
                    <div className="border-t border-line px-4 py-2">
                      <button type="button" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : step.id)} className="hover-link flex w-full items-center gap-2 text-start text-13 text-ink-3">
                        <span className="text-bad num">{n(lost)} stopped before this</span>
                        <span className="text-ink-4">· where they were last</span>
                        <ChevronDown size={14} strokeWidth={1.75} className={cx("ms-auto transition-transform", expanded && "rotate-180")} aria-hidden />
                      </button>
                      {expanded && (
                        <div className="grid grid-cols-3 gap-6 pb-2 pt-3 max-md:grid-cols-1">
                          <Tops title="last page" rows={drop.lastPages} />
                          <Tops title="last thing they did" rows={drop.lastEvents.map((row) => ({ ...row, key: EVENT[row.key] ?? row.key.replace(/_/g, " ") }))} />
                          <div>
                            <div className="t-meta mb-2">how far they scrolled that page</div>
                            {drop.scroll.some(Boolean) ? (
                              <ul className="flex flex-col gap-1">
                                {["under a quarter", "a quarter to half", "half to three quarters", "most or all of it"].map((label, k) => (
                                  <li key={label} className="flex items-center justify-between text-13"><span className="text-ink-2">{label}</span><span className="font-mono num">{n(drop.scroll[k] ?? 0)}</span></li>
                                ))}
                              </ul>
                            ) : <p className="text-13 text-ink-4">no scroll data for them.</p>}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
          <h2 className="mb-3 mt-10 text-16 font-medium tracking-[-0.02em] text-ink">by channel</h2>
          {data.bySource.length ? (
            <Table label="funnel by channel">
              <thead><tr><Th>channel</Th>{data.steps.map((step, i) => <Th key={step.id} className="!text-end" title={step.label}>{i + 1}</Th>)}</tr></thead>
              <tbody>
                {data.bySource.map((row) => (
                  <tr key={row.channel}>
                    <Td className="whitespace-nowrap">{CHANNEL[row.channel] ?? row.channel}</Td>
                    {row.counts.map((count, i) => <Td key={i} className={cx("text-end font-mono text-13 num", count ? "text-ink" : "text-ink-4")}>{n(count)}</Td>)}
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : <p className="text-14 text-ink-3">no one in this window yet.</p>}
          <p className="mt-4 text-12 text-ink-4">each step counts people who also did every step before it. "came back" means any use of the account page or an app on day 1, in week 2 (days 7 to 13) or in month 2 (days 30 to 59) after signing up.</p>
        </>
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
