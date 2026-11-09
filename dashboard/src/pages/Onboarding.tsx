import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { useCloud } from "../data/cloud";
import { useSession } from "../data/session";
import { navigate } from "../lib/router";
import { DOWNLOAD_URL, PHONE_WEB_APP } from "../lib/usage";
import { Button, ButtonLink, Card, cx, Skeleton } from "../ui/kit";
import { Mascot } from "../ui/Mascot";
import { QuickPick } from "./cloud-bits";

type Step = "where" | "plan" | "apps";
const ORDER: Step[] = ["where", "plan", "apps"];

export function Onboarding() {
  const { account, catalog, finishOnboarding } = useCloud();
  const { account: me } = useSession();
  const [step, setStep] = useState<Step>("where");
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
        <span className="flex items-center gap-2.5"><Mascot color="blue" size={20} still /><span className="text-14 font-medium text-ink">OpenMausBot</span></span>
        <div className="flex items-center gap-4">
          <ol className="flex items-center gap-1.5" aria-label={`Step ${ORDER.indexOf(step) + 1} of 3`}>
            {ORDER.map((s, i) => <li key={s} aria-hidden className={cx("h-1 rounded-full", i <= ORDER.indexOf(step) ? "bg-ink" : "bg-track", s === step ? "w-6" : "w-3")} />)}
          </ol>
          <button type="button" onClick={() => void done()} className="hover-link h-11 rounded-full px-2 text-13 text-ink-3">Skip</button>
        </div>
      </header>

      <main className="relative mx-auto max-w-[960px] px-6 pb-16 pt-10 max-sm:px-4 max-sm:pt-4">
        {step === "where" && (
          <section key="where" className="step-in" aria-labelledby="where-title">
            <h1 id="where-title" className="t-title">Welcome, {name}.</h1>
            <p className="mt-2 text-14 text-ink-3">Where should your bots live?</p>
            <div className="mt-8 divide-y divide-line border-y border-line">
              <div className="flex flex-wrap items-center justify-between gap-4 py-6">
                <div><h2 className="text-15 font-medium text-ink">A cloud desktop</h2><p className="mt-1 text-14 text-ink-3">On 24/7, even when your Mac sleeps.</p></div>
                <Button variant="primary" onClick={() => setStep("plan")}>Get a cloud desktop</Button>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-4 py-6">
                <div><h2 className="text-15 font-medium text-ink">My Mac</h2><p className="mt-1 text-14 text-ink-3">Free for personal use. Bots pause when it sleeps.</p></div>
                <Button variant="outline" onClick={() => setStep("apps")}>Use my Mac for now</Button>
              </div>
            </div>
          </section>
        )}

        {step === "plan" && (
          <section key="plan" className="step-in mx-auto max-w-[640px]" aria-labelledby="plan-title">
            <button type="button" onClick={() => setStep("where")} className="press-soft hover-ghost -ms-3 mb-4 inline-flex h-11 items-center gap-1.5 rounded-full px-3 text-13 text-ink-2"><ArrowLeft size={16} strokeWidth={1.5} aria-hidden /> Back</button>
            <h1 id="plan-title" className="t-title">Pick your cloud desktop</h1>
            <p className="mt-2 text-14 leading-[1.55] text-ink-3">Every plan includes a work license and stays on 24/7.</p>
            <Card className="mt-6">
              {catalog ? (
                <QuickPick
                  source="dash_onboarding"
                  catalog={catalog}
                  onDone={() => { setBought(true); setStep("apps"); }}
                  secondary={<Button variant="ghost" onClick={() => setStep("apps")}>Not now</Button>}
                />
              ) : <Skeleton className="h-[150px]" />}
            </Card>
            <p className="mt-4 text-center text-13 text-ink-3">Secure checkout by Dodo Payments. Cancel any time.</p>
          </section>
        )}

        {step === "apps" && (
          <section key="apps" className="step-in mx-auto max-w-[640px]" aria-labelledby="apps-title">
            {bought && <p className="mb-6 flex items-center gap-3 text-14 text-ink-3" role="status"><span className="live-dot shrink-0 text-accent" data-live aria-hidden />Your cloud desktop is being set up.</p>}
            <h1 id="apps-title" className="t-title">Get the apps</h1>
            <p className="mt-2 text-14 text-ink-3">Sign in with this account on each device.</p>
            <ul className="mt-6 divide-y divide-line border-y border-line">
              <li className="flex flex-wrap items-center justify-between gap-4 py-5">
                <h2 className="text-14 font-medium text-ink">Download the app for Mac</h2>
                <ButtonLink to={DOWNLOAD_URL} external variant="primary">Download</ButtonLink>
              </li>
              <li className="flex flex-wrap items-center justify-between gap-4 py-5">
                <h2 className="text-14 font-medium text-ink">Phone</h2>
                <p className="max-w-[420px] text-13 text-ink-3">{PHONE_WEB_APP}</p>
              </li>
            </ul>
            <div className="mt-8 flex justify-end">
              <Button variant="outline" className="!h-11 !px-6" onClick={() => void done()} disabled={leaving}>{leaving ? "Opening" : "Go to my dashboard"}</Button>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
