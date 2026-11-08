import { useState } from "react";
import { ArrowLeft, Check, Download, Laptop, Smartphone } from "lucide-react";
import { useCloud } from "../data/cloud";
import { bundleOf, dollars, yearly } from "../data/pricing";
import { useSession } from "../data/session";
import { navigate } from "../lib/router";
import { DOWNLOAD_URL } from "../lib/usage";
import { Button, ButtonLink, cx, Skeleton } from "../ui/kit";
import { Mascot } from "../ui/Mascot";
import { Nightshift } from "../ui/Nightshift";
import { Stars } from "../ui/Sky";
import { QuickPick } from "./cloud-bits";

type Step = "where" | "plan" | "apps";
const ORDER: Step[] = ["where", "plan", "apps"];

/** first run after sign-up: where the bots live (the cloud desktop first), then the apps */
export function Onboarding() {
  const { account, catalog, finishOnboarding } = useCloud();
  const { account: me } = useSession();
  const [step, setStep] = useState<Step>("where");
  const [bought, setBought] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const name = account?.profile.name || me?.name || me?.email.split("@")[0] || "";
  const starter = catalog ? bundleOf(catalog, "starter") : null;
  const done = async () => {
    setLeaving(true);
    try { await finishOnboarding(); } catch { /* the dashboard asks again next time; never trap anyone here */ }
    navigate(bought ? "/cloud" : "/", { replace: true });
  };

  return (
    <div className="relative min-h-[100dvh] overflow-hidden bg-bg">
      <Stars count={60} seed={8} className="[mask-image:radial-gradient(ellipse_at_top,black_25%,transparent_70%)]" />
      <header className="relative mx-auto flex h-16 max-w-[960px] items-center justify-between px-6 max-sm:px-4">
        <span className="flex items-center gap-2.5"><Mascot color="blue" size={24} still /><span className="text-14 font-medium text-ink">OpenMausBot</span></span>
        <div className="flex items-center gap-4">
          <ol className="flex items-center gap-1.5" aria-label={`Step ${ORDER.indexOf(step) + 1} of 3`}>
            {ORDER.map((s, i) => <li key={s} aria-hidden className={cx("h-1 rounded-full transition-colors duration-200", i <= ORDER.indexOf(step) ? "bg-ink" : "bg-track", s === step ? "w-6" : "w-3")} />)}
          </ol>
          <button type="button" onClick={() => void done()} className="hover-link h-11 rounded-full px-2 text-13 text-ink-3">Skip</button>
        </div>
      </header>

      <main className="relative mx-auto max-w-[960px] px-6 pb-16 pt-10 max-sm:px-4 max-sm:pt-4">
        {step === "where" && (
          <section key="where" className="step-in" aria-labelledby="where-title">
            <h1 id="where-title" className="text-34 font-medium tracking-[-0.025em] text-ink max-sm:text-28">Welcome, {name}.</h1>
            <p className="mt-2 max-w-[56ch] text-16 leading-[1.55] text-ink-3">Where should your bots live? You can change this any time.</p>
            <div className="mt-8 grid gap-4 md:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
              <div className="flex flex-col rounded-card bg-card p-6 ring-1 ring-[color-mix(in_oklab,var(--accent)_45%,transparent)] max-sm:p-5">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-20 font-medium tracking-[-0.01em] text-ink">A cloud desktop</h2>
                  <span className="rounded-full border border-line-2 px-2.5 py-0.5 text-12 text-accent-ink">Recommended</span>
                </div>
                <p className="mt-1.5 text-14 leading-[1.55] text-ink-3">Your own computer in our cloud. Your bots keep working 24/7, even while your Mac sleeps. Set up in one click.</p>
                <Nightshift compact className="mt-5" />
                <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2">
                  <Button variant="primary" className="!h-11 !px-6" onClick={() => setStep("plan")}>Get a cloud desktop</Button>
                  {starter && catalog && <span className="num text-13 text-ink-3">From {dollars(yearly(starter.monthly, catalog), true)}/mo billed yearly</span>}
                </div>
              </div>
              <div className="flex flex-col rounded-card border border-line p-6 max-sm:p-5">
                <span className="grid size-10 place-items-center rounded-[12px] bg-card-2 text-ink-2"><Laptop size={19} strokeWidth={1.5} aria-hidden /></span>
                <h2 className="mt-4 text-16 font-medium text-ink">My Mac for now</h2>
                <p className="mt-1.5 text-14 leading-[1.55] text-ink-3">Free for personal use. Your bots run while your Mac is awake and pause when it sleeps.</p>
                <ul className="mt-4 flex flex-col gap-2 text-13 text-ink-3">
                  <li className="flex gap-2"><Check size={15} strokeWidth={1.75} className="mt-px shrink-0" aria-hidden />Everything in the app, free</li>
                  <li className="flex gap-2"><Check size={15} strokeWidth={1.75} className="mt-px shrink-0" aria-hidden />Add a cloud desktop later in one click</li>
                </ul>
                <Button className="mt-auto w-full !h-11 max-md:mt-6" onClick={() => setStep("apps")}>I'll use my Mac for now</Button>
              </div>
            </div>
          </section>
        )}

        {step === "plan" && (
          <section key="plan" className="step-in mx-auto max-w-[640px]" aria-labelledby="plan-title">
            <button type="button" onClick={() => setStep("where")} className="press-soft hover-ghost -ms-3 mb-4 inline-flex h-11 items-center gap-1.5 rounded-full px-3 text-13 text-ink-2"><ArrowLeft size={15} strokeWidth={1.5} aria-hidden /> Back</button>
            <h1 id="plan-title" className="text-28 font-medium tracking-[-0.02em] text-ink">Pick your cloud desktop</h1>
            <p className="mt-2 text-14 leading-[1.55] text-ink-3">Every plan includes a work license and stays on 24/7. Personal use stays free either way.</p>
            <div className="mt-6 rounded-card bg-card p-6 max-sm:p-5">
              {catalog ? (
                <QuickPick
                  catalog={catalog}
                  onDone={() => { setBought(true); setStep("apps"); }}
                  secondary={<Button variant="ghost" onClick={() => setStep("apps")}>Not now</Button>}
                />
              ) : <Skeleton className="h-[150px]" />}
            </div>
            <p className="mt-4 text-center text-12 text-ink-4">Secure checkout by Dodo Payments. Cancel any time. Yearly saves {catalog ? Math.round(catalog.yearlyDiscount * 100) : 20}% in Plans & billing.</p>
          </section>
        )}

        {step === "apps" && (
          <section key="apps" className="step-in mx-auto max-w-[640px]" aria-labelledby="apps-title">
            {bought && (
              <div className="mb-6 flex items-center gap-3 rounded-[14px] border border-line px-4 py-3" role="status">
                <span className="live-dot text-accent" data-live aria-hidden />
                <p className="text-14 text-ink-2">Your cloud desktop is being set up. It joins your account by itself in about a minute.</p>
              </div>
            )}
            <h1 id="apps-title" className="text-28 font-medium tracking-[-0.02em] text-ink">Bring your bots everywhere</h1>
            <p className="mt-2 text-14 leading-[1.55] text-ink-3">Sign in with this account on each device. They find each other on their own.</p>
            <ul className="mt-6 flex flex-col gap-3">
              <li className="flex flex-wrap items-center gap-4 rounded-card bg-card p-5">
                <span className="grid size-11 shrink-0 place-items-center rounded-[12px] bg-card-2 text-ink-2"><Download size={19} strokeWidth={1.5} aria-hidden /></span>
                <div className="min-w-0 flex-1">
                  <h2 className="text-14 font-medium text-ink">Download the app for Mac</h2>
                  <p className="text-13 leading-[1.5] text-ink-3">Chat with your bots and watch their computers. {bought ? "Your cloud desktop appears in it too." : "Your Mac becomes a workspace."}</p>
                </div>
                <ButtonLink to={DOWNLOAD_URL} external variant="primary">Download</ButtonLink>
              </li>
              <li className="flex flex-wrap items-center gap-4 rounded-card bg-card p-5">
                <span className="grid size-11 shrink-0 place-items-center rounded-[12px] bg-card-2 text-ink-2"><Smartphone size={19} strokeWidth={1.5} aria-hidden /></span>
                <div className="min-w-0 flex-1">
                  <h2 className="text-14 font-medium text-ink">Link your phone</h2>
                  <p className="text-13 leading-[1.5] text-ink-3">Get the mobile app and sign in. Your chats follow you.</p>
                </div>
                <div className="flex gap-2">
                  <ButtonLink to="https://apps.apple.com/app/openmausbot" external size="sm">App Store</ButtonLink>
                  <ButtonLink to="https://play.google.com/store/apps/details?id=com.openmausbot" external size="sm">Google Play</ButtonLink>
                </div>
              </li>
            </ul>
            <div className="mt-8 flex justify-end">
              <Button variant="primary" className="!h-11 !px-6" onClick={() => void done()} disabled={leaving}>{leaving ? "Opening" : "Go to my dashboard"}</Button>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
