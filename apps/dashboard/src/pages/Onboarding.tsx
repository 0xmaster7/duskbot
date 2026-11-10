import { useState } from "react";
import { Check, ChevronDown, ChevronRight } from "lucide-react";
import { useCloud } from "../data/cloud";
import type { CheckoutSource, PlanCatalog } from "../data/contracts";
import { freeTradeoffs, planLine, type FunnelPlan } from "../data/funnel";
import { bundleOf, dollars } from "../data/pricing";
import { useSession } from "../data/session";
import { navigate } from "../lib/router";
import { DOWNLOAD_URL, PHONE_WEB_APP } from "../lib/usage";
import { Button, ButtonLink, cx, Skeleton } from "../ui/kit";
import { Mascot } from "../ui/Mascot";
import { CrewStage, FreeSheet } from "./funnel";
import { planSelection } from "./plan-sheet";

const PAID: FunnelPlan[] = ["starter", "pro"];

/** the cloud desktop, when someone opens it from the start screen: its picture and one white button; Free sits under it,
 * quieter, and opens a plain comparison before it lets you through */
function StartPick({ catalog, onBought, onFree }: { catalog: PlanCatalog; onBought(): void; onFree(): void }) {
  const { checkout } = useCloud();
  const { toast } = useSession();
  const [plan, setPlan] = useState<FunnelPlan>("starter");
  const [busy, setBusy] = useState<CheckoutSource | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [comparing, setComparing] = useState(false);
  const chosen = bundleOf(catalog, plan);
  const price = `${dollars(chosen?.monthly ?? 0)}/mo`;
  const buy = async (source: CheckoutSource) => {
    setBusy(source); setError(null);
    try {
      if (await checkout({ source, kind: "plan", selection: planSelection(catalog, plan, { interval: "month", work: false }), bundle: null })) {
        toast("Paid. Your cloud desktop is being set up.");
        setComparing(false);
        onBought();
      }
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  };
  const checks = freeTradeoffs(catalog, plan).slice(0, 3).map((r) => r.paid);
  return (
    <>
      <article className="mt-8 rounded-card border border-line-2 bg-card p-3 max-sm:mt-6" aria-labelledby="cloud-title">
        <CrewStage />
        <div className="px-4 pb-4 pt-6 max-sm:px-2 max-sm:pb-2 max-sm:pt-5">
          <h2 id="cloud-title" className="text-20 font-semibold tracking-[-0.015em] text-ink">Keep your bots working 24/7</h2>
          <p className="mt-1.5 max-w-[52ch] text-14 leading-[1.55] text-ink-3">A cloud desktop of their own keeps them answering, running routines and using their computers while your Mac sleeps.</p>
          <fieldset className="mt-6 min-w-0">
            <legend className="sr-only">Plan</legend>
            <div className="grid grid-cols-2 gap-2 max-sm:grid-cols-1">
              {PAID.map((id) => {
                const b = bundleOf(catalog, id);
                if (!b) return null;
                const on = plan === id;
                return (
                  <label key={id} htmlFor={`start-${id}`} className={cx("flex cursor-pointer flex-col rounded-[10px] border px-4 py-3.5 has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-ink-3", on ? "border-ink-3 bg-card-2" : "hover-pick border-line-2")}>
                    <input id={`start-${id}`} type="radio" name="start-plan" value={id} checked={on} onChange={() => setPlan(id)} className="sr-only" />
                    <span className="flex items-center justify-between gap-3">
                      <span className="flex items-center gap-2.5">
                        <span aria-hidden className={cx("size-4 shrink-0 rounded-full border", on ? "border-[5px] border-ink" : "border-ink-4")} />
                        <span className="text-15 font-medium text-ink">{b.name}</span>
                      </span>
                      <span className="num text-15 font-medium text-ink">{dollars(b.monthly)}<span className="text-13 font-normal text-ink-3">/mo</span></span>
                    </span>
                    <span className="mt-1 ps-[26px] text-13 text-ink-3">{planLine(catalog, id)}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>
          <ul className="mt-5 flex flex-col gap-2.5">
            {checks.map((c) => <li key={c} className="flex gap-2.5 text-14 text-ink-2"><Check size={16} strokeWidth={1.5} className="mt-0.5 shrink-0 text-good" aria-hidden />{c}</li>)}
          </ul>
          {error && !comparing && <p role="alert" className="mt-4 text-13 text-bad">{error}</p>}
          <Button variant="primary" className="mt-6 w-full !h-11 text-15" onClick={() => void buy("dash_start")} disabled={busy !== null || !chosen}>{busy === "dash_start" ? "Opening checkout" : `Continue with ${chosen?.name}, ${price}`}</Button>
          <p className="mt-3 text-center text-12 text-ink-4">Cancel anytime. Secure checkout by Dodo Payments.</p>
        </div>
      </article>

      <button type="button" onClick={() => { setError(null); setComparing(true); }} className="press-soft hover-row mt-6 flex w-full items-center gap-4 rounded-card px-4 py-3.5 text-start max-sm:px-3">
        <Mascot color="silver" size={28} state="sleeping" still />
        <span className="min-w-0 flex-1">
          <span className="block text-14 text-ink-2">Start with Free</span>
          <span className="block text-13 text-ink-3">Run your bots on your Mac or your own server. $0, personal use.</span>
        </span>
        <ChevronRight size={16} strokeWidth={1.5} className="shrink-0 text-ink-3" aria-hidden />
      </button>

      <FreeSheet
        open={comparing}
        catalog={catalog}
        plan={plan}
        error={comparing ? error : null}
        onClose={() => setComparing(false)}
        onFree={() => { setComparing(false); onFree(); }}
        primary={<Button variant="primary" onClick={() => void buy("dash_free_sheet")} disabled={busy !== null || !chosen}>{busy === "dash_free_sheet" ? "Opening checkout" : `Get ${chosen?.name}, ${price}`}</Button>}
      />
    </>
  );
}

const JOBS = ["Summarize my inbox", "Watch a price", "Plan a trip", "Research a topic"];

/** the start screen: the app and a first job come first (a result in about two minutes, nothing to decide), and a cloud
 * desktop is one quiet row under it for anyone who wants their bots on while the Mac sleeps */
export function Onboarding() {
  const { account, catalog, finishOnboarding } = useCloud();
  const { account: me } = useSession();
  const [cloudOpen, setCloudOpen] = useState(false);
  const [bought, setBought] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const name = account?.profile.name || me?.name || me?.email.split("@")[0] || "";
  const done = async () => {
    setLeaving(true);
    try { await finishOnboarding(); } catch { /* the dashboard asks again next time; never trap anyone here */ }
    navigate(bought ? "/cloud" : "/", { replace: true });
  };

  return (
    <div className="relative min-h-[100dvh] overflow-hidden bg-bg">
      <header className="relative mx-auto flex h-16 max-w-[960px] items-center justify-between px-6 max-sm:px-4">
        <span className="flex items-center gap-2.5"><Mascot color="blue" size={20} still /><span className="text-14 font-medium text-ink">Dusk Bot</span></span>
        <button type="button" onClick={() => void done()} className="hover-link h-11 rounded-full px-2 text-13 text-ink-3">Skip</button>
      </header>

      <main className="relative mx-auto max-w-[960px] px-6 pb-16 pt-10 max-sm:px-4 max-sm:pt-4">
        <section className="step-in mx-auto max-w-[640px]" aria-labelledby="start-title">
          {bought && <p className="mb-6 flex items-center gap-3 text-14 text-ink-3" role="status"><span className="live-dot shrink-0 text-accent" data-live aria-hidden />Your cloud desktop is being set up.</p>}
          <h1 id="start-title" className="t-title">Welcome, {name}.</h1>
          <p className="mt-2 text-14 text-ink-3">Your first bot can be doing a real job in about two minutes. Nothing to set up first.</p>

          <ol className="mt-8 divide-y divide-line border-y border-line">
            <li className="flex flex-wrap items-center justify-between gap-4 py-5">
              <div className="min-w-0">
                <h2 className="text-14 font-medium text-ink">Get the app for Mac</h2>
                <p className="mt-1 text-13 text-ink-3">Sign in with this account. It uses the Claude or ChatGPT sign-in already on your Mac when it finds one.</p>
              </div>
              <ButtonLink to={DOWNLOAD_URL} external variant="primary">Download</ButtonLink>
            </li>
            <li className="py-5">
              <h2 className="text-14 font-medium text-ink">Pick a first job</h2>
              <p className="mt-1 text-13 text-ink-3">The app opens on one question. Pick a job or write your own, and your bot starts right away.</p>
              <ul className="mt-3 flex flex-wrap gap-2" aria-label="Jobs to start with">
                {JOBS.map((job) => <li key={job} className="rounded-full border border-line-2 px-3 py-1.5 text-13 text-ink-2">{job}</li>)}
              </ul>
            </li>
            <li className="flex flex-wrap items-center justify-between gap-4 py-5">
              <h2 className="text-14 font-medium text-ink">Phone</h2>
              <p className="max-w-[420px] text-13 text-ink-3">{PHONE_WEB_APP}</p>
            </li>
          </ol>

          {!bought && (
            <button type="button" aria-expanded={cloudOpen} aria-controls="start-cloud" onClick={() => setCloudOpen((open) => !open)}
              className="press-soft hover-row mt-6 flex w-full items-center gap-4 rounded-card px-4 py-3.5 text-start max-sm:px-3">
              <span className="min-w-0 flex-1">
                <span className="block text-14 text-ink-2">Keep your bots working while your Mac sleeps</span>
                <span className="block text-13 text-ink-3">Optional. A cloud desktop runs them 24/7. You can add one any time.</span>
              </span>
              <ChevronDown size={16} strokeWidth={1.5} className={cx("shrink-0 text-ink-3", cloudOpen && "rotate-180")} aria-hidden />
            </button>
          )}
          {cloudOpen && !bought && (
            <div id="start-cloud">
              {catalog ? <StartPick catalog={catalog} onBought={() => { setBought(true); setCloudOpen(false); }} onFree={() => setCloudOpen(false)} /> : <Skeleton className="mt-8 h-[520px] !rounded-card" />}
            </div>
          )}

          <div className="mt-8 flex justify-end">
            <Button variant="outline" className="!h-11 !px-6" onClick={() => void done()} disabled={leaving}>{leaving ? "Opening" : "Go to my dashboard"}</Button>
          </div>
        </section>
      </main>
    </div>
  );
}
