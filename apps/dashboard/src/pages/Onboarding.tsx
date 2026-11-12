import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, LoaderCircle, Monitor } from "@/icons";
import meadow from "../art/p-meadow.webp";
import { useCloud } from "../data/cloud";
import type { BillingInterval, PlanCatalog } from "../data/contracts";
import { bundleOf, dollars } from "../data/pricing";
import { useSession } from "../data/session";
import { FIXTURE } from "../lib/api";
import { navigate, useLocation } from "../lib/router";
import { planIntent } from "../lib/site";
import { Toggle } from "../ui/controls";
import { Downloads } from "../ui/Downloads";
import { SplitFrame } from "../ui/Frame";
import { Button, cx, Skeleton } from "../ui/kit";
import { Mascot, type MascotHandle } from "../ui/Mascot";
import type { SceneHandle, SceneMood } from "../ui/Scene";
import { CHECKOUT_SOON, Points } from "./cloud-offer";
import { track } from "../lib/analytics";
import { per, planSelection, type PaidPlan } from "./plan-sheet";

const STEPS = ["name", "plan", "app"] as const;
type Step = (typeof STEPS)[number];
type Home = "cloud" | "free";

const SAVED = "dusk-onboarding-step";
const isStep = (v: string | null): v is Step => (STEPS as readonly string[]).includes(v ?? "");
const LABELS = ["say hi", "pick a home", "get the app"];

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
        <span className="absolute -top-[30px] left-0 -translate-x-full"><Mascot ref={rider} body="tofu" color="pink" size={34} state={last ? "celebrate" : "happy"} /></span>
      </div>
    </div>
  );
}

/** dusk cloud first and chosen, this computer as the free way; the plan sits inside the cloud card, priced monthly */
function PlanStep({ catalog, home, setHome, plan, setPlan }: { catalog: PlanCatalog; home: Home; setHome(h: Home): void; plan: PaidPlan; setPlan(p: PaidPlan): void }) {
  const cloud = home === "cloud";
  const plans = (["starter", "pro"] as const).flatMap((id) => { const b = bundleOf(catalog, id); return b ? [{ id, b }] : []; });
  return (
    <fieldset className="min-w-0">
      <legend className="sr-only">where your bots live</legend>
      <div className={cx("rounded-[22px] p-2 transition-[background-color] duration-150", cloud ? "bg-card-2" : "hover-card bg-card")}>
        <label htmlFor="home-cloud" className="focus-tint block cursor-pointer rounded-[16px]">
          <input id="home-cloud" type="radio" name="home" value="cloud" checked={cloud} onChange={() => setHome("cloud")} className="sr-only" />
          <span className="relative block overflow-hidden rounded-[16px]">
            <img src={meadow} alt="" width={800} height={354} className="h-[84px] w-full object-cover object-bottom" draggable={false} />
            <span className="absolute bottom-1 right-4" aria-hidden><Mascot body="kit" color="blue" size={44} state="working" still /></span>
          </span>
          <span className="flex items-baseline justify-between gap-3 px-3 pt-4">
            <span className="text-17 font-medium tracking-[-0.02em] text-ink">dusk cloud</span>
            <span className="num text-14 text-ink-3">from {dollars(plans[0]?.b.monthly ?? 0)}/mo</span>
          </span>
          <Points className="px-3 pb-2 pt-3 [&_li]:text-14" />
        </label>
        {cloud && (
          <div className="step-in flex flex-col gap-2 px-1 pb-1 pt-2">
            <Toggle<PaidPlan> label="plan" className="w-full" value={plan} onChange={setPlan} options={plans.map(({ id, b }) => ({ value: id, label: <>{b.name.toLowerCase()} <span className="num text-ink-4">{per(b.monthly, "month", catalog).amount}/mo</span></> }))} />
          </div>
        )}
      </div>
      <label htmlFor="home-free" className={cx("mt-2 flex cursor-pointer items-center gap-3.5 rounded-[18px] px-4 py-3.5", home === "free" ? "bg-card-2" : "hover-card bg-card", "focus-tint")}>
        <input id="home-free" type="radio" name="home" value="free" checked={home === "free"} onChange={() => setHome("free")} className="sr-only" />
        <Monitor size={20} strokeWidth={1.5} className="shrink-0 text-ink-3" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block text-15 font-medium text-ink">this computer</span>
          <span className="block text-13 leading-[1.4] text-ink-3">bots work while it's awake. add dusk cloud any time.</span>
        </span>
        <span className="num shrink-0 text-14 text-ink-2">free</span>
      </label>
    </fieldset>
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
  const wanted: Step = asked === "done" ? "app" : isStep(asked) ? asked : isStep(saved) ? saved : "name";
  const step: Step = wanted === "plan" && bought ? "app" : wanted;
  const at = STEPS.indexOf(step);
  const guess = account?.profile.name || me?.name || me?.email.split("@")[0] || "";
  const [name, setName] = useState<string | null>(null);
  const [home, setHome] = useState<Home>("cloud");
  const [plan, setPlan] = useState<PaidPlan>(intent?.plan ?? "starter");
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
  useEffect(() => { if (step === "plan") setInterval("month"); }, [step]);
  // each history entry names its step, so back and forward move between steps and a refresh stays put
  useEffect(() => { if (asked !== step && !leaving.current) navigate(here, { replace: true }); }, [asked, step, here]);

  const go = (to: Step) => navigate(address(to));
  const finish = async () => {
    setBusy(true);
    try { await finishOnboarding(); } catch { /* the dashboard asks again next time; never trap anyone here */ }
    sessionStorage.removeItem(SAVED);
    leaving.current = true;
    navigate(path === "/welcome" ? "/" : path, { replace: true });
  };
  const choose = async (where: Home = home) => {
    if (where === "free" || !catalog) { go("app"); return; }
    track({ name: "plan_chosen", props: { plan, period: interval } });
    if (catalog.checkoutOpen === false) { setError(CHECKOUT_SOON); setBusy(false); return; }
    setBusy(true); setError(null);
    sessionStorage.setItem(SAVED, "app");
    const ok = await checkout({ source: "dash_onboarding", kind: "plan", selection: planSelection(catalog, plan, { interval, work: false }), bundle: null });
    if (!ok) { sessionStorage.setItem(SAVED, "plan"); setError("checkout didn't open. try again."); setBusy(false); return; }
    // the live page is on its way to the payment page; fixtures pay at once
    if (FIXTURE) { toast("paid. your dusk cloud is being set up."); setBusy(false); go("app"); }
  };
  // a plan picked on the site goes from the name straight to checkout
  const direct = Boolean(intent) && !bought;
  const saveName = async () => {
    const next = shownName.trim();
    if (!next) { setError("a name, any name."); return; }
    setBusy(true); setError(null);
    try { if (next !== (account?.profile.name ?? "")) await updateProfile(next); }
    catch (e) { setError((e as Error).message); setBusy(false); return; }
    if (direct && catalog) { await choose("cloud"); return; }
    setBusy(false);
    go(bought ? "app" : "plan");
  };

  const chosen = catalog ? bundleOf(catalog, plan) : null;
  const price = chosen && catalog ? per(chosen.monthly, interval, catalog) : null;
  const mood: SceneMood = busy ? "thinking" : focused ? "typing" : "idle";
  const back = (to: Step) => <button type="button" onClick={() => go(to)} className="text-link -ms-2 inline-flex h-11 items-center gap-1.5 rounded-full px-2 text-14"><ArrowLeft size={15} strokeWidth={1.75} aria-hidden />back</button>;
  const big = "w-full !h-12 !text-15";

  return (
    <SplitFrame
      mood={mood}
      step={at}
      scene={scene}
      snug
      card={<p key={step} className="swap-in flex items-end gap-3.5"><span className="font-pixel text-[72px] font-medium leading-[0.72] text-ink">{at + 1}</span><span className="pb-0.5 text-20 font-medium tracking-[-0.03em] text-ink">{LABELS[at]}</span></p>}
      aside={<button type="button" onClick={() => void finish()} disabled={busy} className="text-link -me-2 h-11 rounded-full px-2 text-14">skip</button>}
    >
      <Rail at={at} />
      {step === "name" ? (
        <form key="name" className="step-in" onSubmit={(e) => { e.preventDefault(); void saveName(); }} noValidate>
          <h1 className="t-title">hi. what should we call you?</h1>
          <p className="mt-3 text-16 text-ink-2">{direct ? "then checkout, and your dusk cloud starts setting up." : "two quick things and you're in."}</p>
          <label htmlFor="onb-name" className="mb-2 mt-7 block text-14 text-ink-2">your name</label>
          <input id="onb-name" autoComplete="given-name" maxLength={60} value={shownName} onChange={(e) => { setName(e.target.value); setError(null); }} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} className="field !h-12" aria-invalid={Boolean(error)} aria-describedby={error ? "onb-error" : undefined} />
          {direct && (
            <div className="mt-4 flex items-center gap-3 rounded-[16px] bg-card p-2 pe-4">
              <img src={meadow} alt="" width={800} height={354} className="h-12 w-16 shrink-0 rounded-[10px] object-cover object-bottom" draggable={false} />
              <span className="min-w-0 flex-1">
                <span className="block text-14 font-medium text-ink">dusk cloud, {chosen?.name.toLowerCase() ?? "plus"}</span>
                <span className="num block text-13 text-ink-3">{price ? `${price.amount}${price.unit}, cancel any time` : <Skeleton className="h-4 w-28" />}</span>
              </span>
              <button type="button" onClick={() => go("plan")} className="text-link h-11 shrink-0 rounded-full px-1 text-14">change</button>
            </div>
          )}
          {error && <p id="onb-error" role="alert" className="mt-2.5 text-14 text-bad">{error}</p>}
          <Button type="submit" variant="primary" className={cx("mt-3", big)} disabled={busy || (direct && !catalog)}>{busy ? <Busy>{direct ? "opening checkout" : "saving"}</Busy> : direct ? "continue to checkout" : "continue"}</Button>
        </form>
      ) : step === "plan" ? (
        <div key="plan" className="step-in">
          <h1 className="t-title">where should your bots live?</h1>
          <p className="mb-6 mt-3 text-16 text-ink-2">on dusk cloud they keep working 24/7, even when your computer is off.</p>
          {catalog ? <PlanStep catalog={catalog} home={home} setHome={(h) => { setHome(h); setError(null); }} plan={plan} setPlan={setPlan} /> : <div className="flex flex-col gap-2" aria-busy="true"><Skeleton className="h-[300px] !rounded-[22px]" /><Skeleton className="h-[72px] !rounded-[18px]" /></div>}
          {error && <p role="alert" className="mt-3 text-14 text-bad">{error}</p>}
          <Button variant="primary" className={cx("mt-5", big)} onClick={() => void choose()} disabled={busy || !catalog}>{busy ? <Busy>opening checkout</Busy> : home === "cloud" && price ? `continue to checkout, ${price.amount}${price.unit}` : "continue with free"}</Button>
          <div className="mt-2 flex items-center justify-between gap-3">{back("name")}{home === "cloud" && <span className="t-meta">cancel any time</span>}</div>
        </div>
      ) : (
        <div key="app" className="step-in">
          {bought && <p className="tag mb-4 !bg-lime !text-ink" role="status"><span className="live-dot text-good" data-live />your dusk cloud is being set up</p>}
          <h1 className="t-title">get the app.</h1>
          <p className="mt-3 text-16 text-ink-2">sign in with this account and make your first bot.</p>
          <div className="mt-6"><Downloads /></div>
          <Button variant="primary" className={cx("mt-5", big)} onClick={() => void finish()} disabled={busy}>{busy ? <Busy>opening</Busy> : "continue"}</Button>
          {!bought && <div className="mt-1">{back("plan")}</div>}
        </div>
      )}
    </SplitFrame>
  );
}
