import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, Download, LoaderCircle } from "lucide-react";
import meadow from "../art/p-meadow.webp";
import peaks from "../art/p-peaks.webp";
import sky from "../art/p-sky.webp";
import poster from "../art/poster-layers.webp";
import { useCloud } from "../data/cloud";
import type { BillingInterval, PlanCatalog } from "../data/contracts";
import { planLine, type FunnelPlan } from "../data/funnel";
import { bundleOf } from "../data/pricing";
import { useSession } from "../data/session";
import { FIXTURE } from "../lib/api";
import { navigate, useLocation } from "../lib/router";
import { planIntent } from "../lib/site";
import { DOWNLOAD_URL } from "../lib/usage";
import { SplitFrame } from "../ui/Frame";
import { Button, cx, Skeleton } from "../ui/kit";
import { Mascot, type MascotHandle } from "../ui/Mascot";
import type { SceneHandle, SceneMood } from "../ui/Scene";
import { IntervalToggle, per, planSelection } from "./plan-sheet";

const STEPS = ["name", "plan", "app", "done"] as const;
type Step = (typeof STEPS)[number];
type Pick = "free" | FunnelPlan;

const SAVED = "dusk-onboarding-step";
const isStep = (v: string | null): v is Step => (STEPS as readonly string[]).includes(v ?? "");
const JOBS = ["summarise my inbox", "watch a price", "plan a trip", "research a topic"];
const ART: Record<Pick, string> = { free: sky, starter: meadow, pro: peaks };

function Busy({ children }: { children: ReactNode }) {
  return <><LoaderCircle size={17} strokeWidth={2} className="spin" aria-hidden />{children}</>;
}

/** how far along: a rail that fills, and a small bot that rides its leading edge and hops when a step lands */
function Rail({ at }: { at: number }) {
  const rider = useRef<MascotHandle>(null);
  const last = at === STEPS.length - 1;
  const part = (at + 1) / STEPS.length;
  useEffect(() => { rider.current?.react("hop"); }, [at]);
  return (
    <div className="relative mb-10 h-2 rounded-full bg-track [overflow-x:clip]" role="progressbar" aria-valuemin={1} aria-valuemax={STEPS.length} aria-valuenow={at + 1} aria-label={`step ${at + 1} of ${STEPS.length}`}>
      <div className="h-full origin-left rounded-full bg-ink transition-transform duration-500 ease-[var(--ease-out)] motion-reduce:transition-none" style={{ transform: `scaleX(${part})` }} />
      <div className="pointer-events-none absolute inset-0 transition-transform duration-500 ease-[var(--ease-pop)] motion-reduce:transition-none" style={{ transform: `translateX(${part * 100}%)` }} aria-hidden>
        <span className="absolute -top-[30px] left-0 -translate-x-full"><Mascot ref={rider} body="pixel" color="pink" size={34} state={last ? "celebrate" : "happy"} /></span>
      </div>
    </div>
  );
}

function PlanStep({ catalog, pick, setPick, interval, setInterval }: { catalog: PlanCatalog; pick: Pick; setPick(p: Pick): void; interval: BillingInterval; setInterval(v: BillingInterval): void }) {
  const rows: Array<{ id: Pick; name: string; line: string; price: ReactNode }> = [
    { id: "free", name: "free", line: "on your own computer. they work while it's awake.", price: "$0" },
    ...(["starter", "pro"] as const).flatMap((id) => {
      const b = bundleOf(catalog, id);
      if (!b) return [];
      const p = per(b.monthly, interval, catalog);
      return [{ id, name: b.name.toLowerCase(), line: id === "starter" ? `a cloud desktop, on 24/7. ${planLine(catalog, id).toLowerCase()}.` : `a bigger one. ${planLine(catalog, id).toLowerCase()}.`, price: <>{p.amount}<span className="text-13 font-normal text-ink-3">{p.unit}</span></> }];
    }),
  ];
  return (
    <>
      <fieldset className="min-w-0">
        <legend className="sr-only">plan</legend>
        <div className="flex flex-col gap-2">
          {rows.map((r) => {
            const on = pick === r.id;
            return (
              <label key={r.id} htmlFor={`plan-${r.id}`} className={cx("press-soft flex cursor-pointer items-center gap-3.5 rounded-[20px] p-2.5 pe-4 has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-accent", on ? "bg-ink text-bg" : "hover-outline bg-btn text-ink")}>
                <input id={`plan-${r.id}`} type="radio" name="plan" value={r.id} checked={on} onChange={() => setPick(r.id)} className="sr-only" />
                <img src={ART[r.id]} alt="" width={72} height={56} className="h-14 w-[72px] shrink-0 rounded-[12px] object-cover" draggable={false} />
                <span className="min-w-0 flex-1">
                  <span className="block text-16 font-medium tracking-[-0.02em]">{r.name}</span>
                  <span className={cx("block text-13 leading-[1.35]", on ? "text-bg/70" : "text-ink-3")}>{r.line}</span>
                </span>
                <span className="num shrink-0 text-16 font-medium">{r.price}</span>
              </label>
            );
          })}
        </div>
      </fieldset>
      {pick !== "free" && <div className="step-in mt-4"><IntervalToggle value={interval} onChange={setInterval} catalog={catalog} /></div>}
    </>
  );
}

/** the first minutes of an account, one step at a time: a name, where the bots live, the app, done. a plan picked on the
 * site arrives chosen; the step survives a refresh and the trip to checkout */
export function Onboarding() {
  const { account, catalog, billing, clouds, checkout, updateProfile, finishOnboarding } = useCloud();
  const { account: me, toast } = useSession();
  const { path, query } = useLocation();
  const intent = planIntent(query);
  // an open checkout already has a machine reserved: only a paid one counts
  const bought = billing?.subscription?.status === "active" || billing?.subscription?.status === "past_due" || Boolean(clouds?.some((cloud) => !cloud.awaitingPayment));
  const asked = query.get("step");
  const saved = sessionStorage.getItem(SAVED);
  const wanted: Step = isStep(asked) ? asked : isStep(saved) ? saved : "name";
  const step: Step = wanted === "plan" && bought ? "app" : wanted;
  const at = STEPS.indexOf(step);
  const guess = account?.profile.name || me?.name || me?.email.split("@")[0] || "";
  const [name, setName] = useState<string | null>(null);
  const [pick, setPick] = useState<Pick>(intent?.plan ?? "free");
  const [interval, setInterval] = useState<BillingInterval>(intent?.interval ?? "month");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const scene = useRef<SceneHandle>(null);
  const leaving = useRef(false);
  const shownName = name ?? guess;

  const search = query.toString();
  const address = (to: Step) => {
    const params = new URLSearchParams(search);
    params.set("step", to);
    return `${path}?${params}`;
  };
  const here = address(step);
  useEffect(() => { sessionStorage.setItem(SAVED, step); }, [step]);
  useEffect(() => { setError(null); scene.current?.react("perk"); }, [step]);
  // each history entry names its step, so back and forward move between steps and a refresh stays put
  useEffect(() => { if (asked !== step && !leaving.current) navigate(here, { replace: true }); }, [asked, step, here]);

  const go = (to: Step) => navigate(address(to));
  const finish = async () => {
    setBusy(true);
    try { await finishOnboarding(); } catch { /* the dashboard asks again next time; never trap anyone here */ }
    sessionStorage.removeItem(SAVED);
    leaving.current = true;
    navigate(bought ? "/cloud" : path === "/welcome" ? "/" : path, { replace: true });
  };
  const saveName = async () => {
    const next = shownName.trim();
    if (!next) { setError("a name, any name."); return; }
    setBusy(true); setError(null);
    try { if (next !== (account?.profile.name ?? "")) await updateProfile(next); go(bought ? "app" : "plan"); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const choose = async () => {
    if (pick === "free" || !catalog) { go("app"); return; }
    setBusy(true); setError(null);
    sessionStorage.setItem(SAVED, "app");
    const ok = await checkout({ source: "dash_onboarding", kind: "plan", selection: planSelection(catalog, pick, { interval, work: false }), bundle: null });
    if (!ok) { sessionStorage.setItem(SAVED, "plan"); setError("checkout didn't open. try again."); setBusy(false); return; }
    // the live page is on its way to the payment page; fixtures pay at once
    if (FIXTURE) { toast("paid. your cloud desktop is being set up."); setBusy(false); go("app"); }
  };

  const chosen = pick !== "free" && catalog ? bundleOf(catalog, pick) : null;
  const price = chosen && catalog ? per(chosen.monthly, interval, catalog) : null;
  const mood: SceneMood = step === "done" ? "party" : busy ? "thinking" : focused ? "typing" : "idle";
  const back = (to: Step) => <button type="button" onClick={() => go(to)} className="hover-link -ms-2 inline-flex h-11 items-center gap-1.5 rounded-full px-2 text-14 text-ink-3"><ArrowLeft size={15} strokeWidth={1.75} aria-hidden />back</button>;

  return (
    <SplitFrame
      poster={poster}
      mood={mood}
      scene={scene}
      snug
      card={<p key={step} className="swap-in flex items-end gap-3.5"><span className="font-pixel text-[72px] font-medium leading-[0.72] text-ink">{at + 1}</span><span className="pb-0.5 text-20 font-medium tracking-[-0.03em] text-ink">{["say hi", "pick a home", "get the app", "that's it"][at]}</span></p>}
      aside={step !== "done" && <button type="button" onClick={() => void finish()} disabled={busy} className="hover-link -me-2 h-11 rounded-full px-2 text-14 text-ink-3">skip</button>}
    >
      <Rail at={at} />
      {step === "name" ? (
        <form key="name" className="step-in" onSubmit={(e) => { e.preventDefault(); void saveName(); }} noValidate>
          <h1 className="t-title">hi. what should we call you?</h1>
          <p className="mt-3 text-16 text-ink-2">your account is ready. two quick things and you're in.</p>
          <label htmlFor="onb-name" className="mb-2 mt-7 block text-14 text-ink-2">your name</label>
          <input id="onb-name" autoComplete="given-name" maxLength={60} value={shownName} onChange={(e) => { setName(e.target.value); setError(null); }} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} className="field !h-12" aria-invalid={Boolean(error)} aria-describedby={error ? "onb-error" : undefined} />
          {error && <p id="onb-error" role="alert" className="mt-2.5 text-14 text-bad">{error}</p>}
          <Button type="submit" variant="primary" className="mt-3 w-full !h-12 !text-15" disabled={busy}>{busy ? <Busy>saving</Busy> : "continue"}</Button>
        </form>
      ) : step === "plan" ? (
        <div key="plan" className="step-in">
          <h1 className="t-title">where should your bots live?</h1>
          <p className="mb-7 mt-3 text-16 text-ink-2">free runs them on your computer. a cloud desktop keeps them going with the laptop shut.</p>
          {catalog ? <PlanStep catalog={catalog} pick={pick} setPick={(p) => { setPick(p); setError(null); }} interval={interval} setInterval={setInterval} /> : <div className="flex flex-col gap-2" aria-busy="true"><Skeleton className="h-[76px] !rounded-[20px]" /><Skeleton className="h-[76px] !rounded-[20px]" /><Skeleton className="h-[76px] !rounded-[20px]" /></div>}
          {error && <p role="alert" className="mt-3 text-14 text-bad">{error}</p>}
          <Button variant="primary" className="mt-5 w-full !h-12 !text-15" onClick={() => void choose()} disabled={busy || !catalog}>{busy ? <Busy>opening checkout</Busy> : price && chosen ? `checkout, ${chosen.name.toLowerCase()} ${price.amount}${price.unit}` : "continue with free"}</Button>
          <div className="mt-2 flex items-center justify-between gap-3">{back("name")}{pick !== "free" && <span className="t-meta">cancel anytime</span>}</div>
        </div>
      ) : step === "app" ? (
        <div key="app" className="step-in">
          {bought && <p className="tag mb-4 !bg-lime !text-ink" role="status"><span className="live-dot text-good" data-live />your cloud desktop is being set up</p>}
          <h1 className="t-title">now get the app.</h1>
          <p className="mt-3 text-16 text-ink-2">it's a normal app. sign in with this account, make a bot, and hand it something real.</p>
          <ul className="mt-6 flex flex-wrap gap-1.5" aria-label="first jobs people try">
            {JOBS.map((job) => <li key={job} className="rounded-full bg-btn px-3.5 py-2 text-14 text-ink-2">{job}</li>)}
          </ul>
          <div className="mt-7 flex flex-col gap-2">
            <a href={DOWNLOAD_URL} target="_blank" rel="noreferrer" onClick={() => go("done")} className="press hover-primary inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-primary text-15 font-medium text-primary-ink"><Download size={17} strokeWidth={1.75} aria-hidden />download dusk bot</a>
            <Button className="w-full !h-12 !text-15" onClick={() => go("done")}>i have it already</Button>
          </div>
          <p className="t-meta mt-4">on your phone? pair it later from settings in the app.</p>
          {!bought && <div className="mt-1">{back("plan")}</div>}
        </div>
      ) : (
        <div key="done" className="step-in">
          <h1 className="t-title">you're all set{shownName.trim() ? `, ${shownName.trim()}` : ""}.</h1>
          <p className="mt-3 text-16 text-ink-2">{bought ? "your cloud desktop is waking up. your bots move in next." : "your bots show up here as soon as the app is connected."}</p>
          <Button variant="primary" className="mt-7 w-full !h-12 !text-15" onClick={() => void finish()} disabled={busy}>{busy ? <Busy>opening</Busy> : "go to my dashboard"}</Button>
        </div>
      )}
    </SplitFrame>
  );
}
