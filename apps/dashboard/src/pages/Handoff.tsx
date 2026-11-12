import { useEffect, useRef, useState } from "react";
import { useSession } from "../data/session";
import { forgetHandoff, handoffNext, handoffToken, leaveHandoff as go } from "../data/handoff";
import { api } from "../lib/api";
import { Button, ButtonLink } from "../ui/kit";
import { SkyEmpty } from "../ui/Sky";

type Step = { kind: "working" } | { kind: "ask"; why: "confirm" | "other_account"; email: string } | { kind: "expired" } | { kind: "failed"; message: string };

/** the desktop app opens the website here; the link works once, for about two minutes, and only after the person
 * confirms the account (unless this browser is already signed in to it) */
export function HandoffPage() {
  const { account } = useSession();
  const [step, setStep] = useState<Step>({ kind: "working" });
  const started = useRef(false);

  const redeem = async (opts: { confirm?: boolean; replace?: boolean } = {}) => {
    const token = handoffToken();
    if (!token) { setStep({ kind: "expired" }); return; }
    setStep({ kind: "working" });
    try {
      const answer = await api.handoff(token, opts);
      if ("ask" in answer) { setStep({ kind: "ask", why: answer.ask, email: answer.email }); return; }
      forgetHandoff();
      go(handoffNext(answer.next));
    } catch (e) {
      forgetHandoff();
      const status = (e as { status?: number }).status;
      setStep(status === 0 ? { kind: "failed", message: (e as Error).message } : { kind: "expired" });
    }
  };

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void redeem();
  }, []);

  let body = <div className="min-h-[100dvh] bg-bg" aria-busy="true" />;
  if (step.kind === "ask") {
    const other = step.why === "other_account";
    body = (
      <SkyEmpty title={`continue as ${step.email}?`} className="w-full max-w-[520px]" action={<>
        <Button variant="primary" onClick={() => void redeem({ confirm: true, ...(other ? { replace: true } : {}) })}>continue to checkout as {step.email}</Button>
        <Button onClick={() => { forgetHandoff(); go("/sign-in"); }}>not you? sign in</Button>
      </>}>{other ? `this browser is signed in as ${account?.email ?? "another account"}.` : "the dusk bot app opened this page for that account."}</SkyEmpty>
    );
  } else if (step.kind === "expired") {
    body = <SkyEmpty title="that link has expired" className="w-full max-w-[520px]" action={<ButtonLink to="/sign-in" variant="primary">sign in</ButtonLink>}>open it again from the app, or sign in here.</SkyEmpty>;
  } else if (step.kind === "failed") {
    body = <SkyEmpty title="can't sign you in right now" className="w-full max-w-[520px]" action={<ButtonLink to="/sign-in" variant="primary">sign in</ButtonLink>}>{step.message}</SkyEmpty>;
  }
  return step.kind === "working" ? body : <main className="flex min-h-[100dvh] items-center justify-center bg-bg px-6">{body}</main>;
}
