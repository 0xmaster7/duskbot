import { useEffect, useState } from "react";
import { cx, Segmented } from "../ui/kit";
import { AnimatePresence, m, Pill, usePill } from "../ui/motion";
import { Figure } from "../ui/Figure";
import { useAdmin } from "./api";
import { CHANNEL, percent, type Range } from "./kit";
import { Failed, Loading, n } from "./ui";

interface Drop { count: number; lastPages: Array<{ key: string; count: number }>; lastEvents: Array<{ key: string; count: number }>; scroll: number[] }
export interface FunnelAnswer {
  mode: "visitors" | "signups"; steps: Array<{ id: string; label: string; count: number }>; bySource: Array<{ channel: string; counts: number[] }>;
  dropoff?: Record<string, Drop>;
  upsells?: Array<{ source: string; shown: number; clicked: number; dismissed: number; paid: number }>;
}

const UPSELL: Record<string, string> = { dash_sidebar: "sidebar card", dash_invested: "home note", dash_routines: "routines prompt", dash_home: "home pitch", dash_billing: "plans page" };
const FUNNEL_CHANNEL: Record<string, string> = { ai: "ai assistants", referral: "referrals", unknown: "not tracked" };
const EVENT: Record<string, string> = { click: "a click", site_view: "viewing a page", cta_click: "clicking sign up", download_click: "clicking download", outbound: "leaving for another site", waitlist_join: "joining the waitlist",
  page_view: "an account page", onboarding_step: "an onboarding step", sign_in: "signing in", signup: "signing up", app_open: "opening the app" };
const SCROLL = ["under a quarter of the way down", "about halfway down", "most of the way down", "to the bottom"];
/** the stages a step belongs to, each its own soft colour: on the site, getting set up, paying, using it, coming back */
function stageOf(id: string) {
  if (id === "visit") return "bg-wash-sky";
  if (id === "signup" || id.startsWith("onboard")) return "bg-wash-lilac";
  if (id === "cloud" || id === "paid") return "bg-wash-lime";
  if (id === "paired" || id === "replied") return "bg-wash-lemon";
  return "bg-wash-pink";
}

/** why people left after a step, in one plain sentence from what they did last */
function reasonOf(drop: Drop | undefined) {
  if (!drop) return null;
  const page = drop.lastPages[0], event = drop.lastEvents[0];
  const most = drop.scroll.some(Boolean) ? drop.scroll.indexOf(Math.max(...drop.scroll)) : -1;
  const parts = [page && `most of them last saw ${page.key}`, event && `their last move was ${EVENT[event.key] ?? event.key.replace(/_/g, " ")}`, most >= 0 && `most scrolled ${SCROLL[most]}`].filter(Boolean);
  return parts.length ? `${parts.join(", ")}.` : null;
}

/** the funnel as descending bars: each step's people as a bar against the first step, what was kept between steps as a
 * pill, and the biggest drop said in words with what those people did last */
export function FunnelChart({ range }: { range: Range }) {
  const [mode, setMode] = useState<"visitors" | "signups">("visitors");
  const [channel, setChannel] = useState("all");
  const pill = usePill();
  const { data, error, loading, reload } = useAdmin<FunnelAnswer>(`/funnel?from=${range.from}&to=${range.to}&mode=${mode}`);
  useEffect(() => { if (data && location.hash === "#funnel") document.getElementById("funnel")?.scrollIntoView({ block: "start" }); }, [Boolean(data)]);
  const row = data?.bySource.find((r) => r.channel === channel);
  const counts = data ? (row ? row.counts : data.steps.map((step) => step.count)) : [];
  const first = Math.max(1, counts[0] ?? 1);
  const drops = data ? data.steps.map((step, i) => i === 0 ? null : { kept: counts[i - 1] ? counts[i]! / counts[i - 1]! : null, lost: (counts[i - 1] ?? 0) - (counts[i] ?? 0), base: counts[i - 1] ?? 0, from: data.steps[i - 1]!, to: step }) : [];
  const worst = drops.filter((d): d is NonNullable<typeof d> => d !== null && d.kept !== null && d.base >= 3).sort((a, b) => (a.kept ?? 1) - (b.kept ?? 1))[0] ?? null;
  const reason = worst && channel === "all" ? reasonOf(data?.dropoff?.[worst.from.id]) : null;
  const upsells = data?.upsells ?? [];
  return (
    <section id="funnel" aria-labelledby="funnel-title" className="scroll-mt-6 rounded-[24px] bg-card p-2">
      <div className="flex flex-wrap items-center justify-between gap-2 px-2 pb-1.5 pt-1">
        <h2 id="funnel-title" className="inline-flex h-8 items-center text-14 font-medium text-ink">funnel</h2>
        <Segmented<"visitors" | "signups"> label="start from" value={mode} onChange={setMode} options={[{ value: "visitors", label: "from visitors" }, { value: "signups", label: "from signups" }]} />
      </div>
      <div className="rounded-[18px] bg-pop p-3">
        {error ? <Failed error={error} retry={reload} /> : !data ? <Loading rows={4} /> : (
          <div className={cx("transition-opacity duration-150", loading && "opacity-70")}>
            {data.bySource.length > 0 && (
              <div role="radiogroup" aria-label="channel" className="scroll-x mb-3 flex gap-0.5">
                {[{ channel: "all" }, ...data.bySource].map((r) => (
                  <button key={r.channel} type="button" role="radio" aria-checked={channel === r.channel} onClick={() => setChannel(r.channel)}
                    className={cx("relative h-8 shrink-0 rounded-full px-3 text-13", channel === r.channel ? "font-medium text-ink" : "text-ink-3 hover-link")}>
                    {channel === r.channel && <Pill id={pill} className="bg-card" />}
                    <span className="relative">{r.channel === "all" ? "every channel" : CHANNEL[r.channel] ?? FUNNEL_CHANNEL[r.channel] ?? r.channel}</span>
                  </button>
                ))}
              </div>
            )}
            <ol className="flex flex-col gap-1" aria-label="funnel steps">
              <AnimatePresence initial={false} mode="popLayout">
              {data.steps.map((step, i) => {
                const share = (counts[i] ?? 0) / first, drop = drops[i], isWorst = drop !== null && drop === worst;
                return (
                  <m.li key={step.id} layout="position" className="grid grid-cols-[minmax(0,168px)_minmax(0,1fr)_76px] items-center gap-3 max-sm:grid-cols-[minmax(0,1fr)_72px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.12 } }} transition={{ layout: { type: "spring", visualDuration: 0.3, bounce: 0 }, opacity: { duration: 0.18 } }}>
                    <span className="truncate text-13 text-ink-2 max-sm:col-span-2 max-sm:-mb-1 max-sm:text-12" title={step.label}>{step.label}</span>
                    <span className="relative flex h-9 items-center overflow-hidden rounded-[10px] px-3">
                      <m.span className={cx("absolute inset-0", stageOf(step.id))} initial={{ clipPath: "inset(0% 100% 0% 0% round 10px)" }}
                        animate={{ clipPath: `inset(0% ${(100 - Math.max(1.5, share * 100)).toFixed(2)}% 0% 0% round 10px)` }} transition={{ type: "spring", visualDuration: 0.45, bounce: 0, delay: Math.min(0.3, i * 0.03) }} aria-hidden />
                      <span className="relative flex items-baseline gap-2">
                        <Figure value={n(counts[i] ?? 0)} className="!font-mono !text-15 !leading-6 !tracking-[-0.02em]" />
                        <Figure value={i === 0 ? "start" : `${percent(share)} of start`} className="!font-mono !text-12 !font-medium !leading-4 !tracking-normal !text-ink-3" />
                      </span>
                    </span>
                    <span className="flex justify-end">
                      {drop && drop.kept !== null && (
                        <span className={cx("inline-flex h-6 items-center whitespace-nowrap rounded-full px-2 font-mono text-12 num", isWorst ? "bg-wash-pink font-medium text-bad" : "bg-card text-ink-3")}
                          title={`${n(drop.lost)} stopped after "${drop.from.label}"`}>
                          <Figure value={drop.kept >= 1 ? "kept all" : `-${percent(1 - drop.kept)}`} className="!font-mono !text-12 !leading-4 !tracking-normal ![color:inherit]" />
                        </span>
                      )}
                    </span>
                  </m.li>
                );
              })}
              </AnimatePresence>
            </ol>
            <AnimatePresence initial={false} mode="wait">
              <m.div key={worst ? `${worst.from.id}:${channel}:${mode}` : "none"} className="mt-3 rounded-[14px] bg-wash-pink/60 px-3.5 py-2.5 text-13 text-ink-2" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: 0.1 } }}>
                {worst ? <>
                  <span className="font-medium text-ink">biggest drop: </span>{percent(1 - (worst.kept ?? 0))} stop between "{worst.from.label}" and "{worst.to.label}" ({n(worst.lost)} people).{reason ? ` ${reason}` : ""}
                </> : "not enough people in this window to call a biggest drop."}
              </m.div>
            </AnimatePresence>
          </div>
        )}
      </div>
      {data && (
        <div className="mt-1.5 rounded-[18px] bg-pop p-3">
          <h3 className="text-13 font-medium text-ink">which upsell converts</h3>
          {upsells.length ? (
            <table className="mt-2 w-full text-13">
              <thead><tr className="t-meta"><th scope="col" className="py-1 text-start font-medium">where</th><th scope="col" className="py-1 text-end font-medium">shown</th><th scope="col" className="py-1 text-end font-medium">clicked</th><th scope="col" className="py-1 text-end font-medium">paid</th><th scope="col" className="py-1 text-end font-medium">click rate</th></tr></thead>
              <tbody>
                {upsells.map((u) => (
                  <tr key={u.source}>
                    <th scope="row" className="py-1.5 text-start font-normal text-ink">{UPSELL[u.source] ?? u.source.replace(/_/g, " ")}</th>
                    <td className="py-1.5 text-end font-mono num">{n(u.shown)}</td>
                    <td className="py-1.5 text-end font-mono num">{n(u.clicked)}</td>
                    <td className={cx("py-1.5 text-end font-mono num", u.paid ? "font-medium text-ink" : "text-ink-4")}>{n(u.paid)}</td>
                    <td className="py-1.5 text-end font-mono text-ink-3 num">{u.shown ? percent(u.clicked / u.shown) : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="mt-1 text-13 text-ink-3">no upsell was shown in this window.</p>}
        </div>
      )}
    </section>
  );
}
