import { useEffect, useRef, useState, type ReactNode } from "react";
import { useSession } from "../data/session";
import { api, ApiError } from "../lib/api";
import { Button } from "../ui/kit";
import { Mascot } from "../ui/Mascot";
import { Stars } from "../ui/Sky";

const REASON: Record<string, string> = {
  wrong_code: "That code does not match. Check the latest email and try again.",
  expired: "That code expired. Send a new one.",
  sso: "Your organization signs in through its own provider. Sign in from the app instead.",
  two_factor: "This account uses two-step sign-in. Sign in from the app instead.",
  signup_closed: "There is no account for this email yet. Create one in the app first.",
  device_limit: "This account has reached its device limit. Sign out somewhere else and try again.",
  rate_limited: "Too many tries. Wait a minute, then try again.",
  offline: "The dashboard could not be reached. Check your connection.",
};

const field = "h-11 w-full rounded-[12px] border border-line-2 bg-transparent px-3.5 text-14 text-ink outline-none transition-colors duration-150 placeholder:text-ink-4 focus-visible:border-ink-3";

/** the signed-out page: a quiet night sky, one mascot peeking over the card */
export function SignInScreen({ note }: { note?: ReactNode }) {
  const { setAccount } = useSession();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [attempt, setAttempt] = useState<string | null>(null);
  const [resendAt, setResendAt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, force] = useState(0);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (step === "code") codeRef.current?.focus(); }, [step]);
  useEffect(() => {
    if (step !== "code" || Date.now() >= resendAt) return;
    const id = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [step, resendAt]);

  const reason = (e: unknown) => (e instanceof ApiError && e.code && REASON[e.code]) || (e as Error).message || "Sign-in did not work. Try again.";

  const send = async () => {
    setBusy(true); setError(null);
    try {
      const r = await api.start(email.trim());
      setAttempt(r.attempt); setResendAt(Date.now() + r.resendAfter * 1000); setStep("code"); setCode("");
    } catch (e) { setError(reason(e)); } finally { setBusy(false); }
  };
  const verify = async () => {
    if (!attempt) return;
    setBusy(true); setError(null);
    try { const r = await api.verify(attempt, code); setAccount(r.account); } catch (e) { setError(reason(e)); if (e instanceof ApiError && e.code === "expired") setAttempt(null); } finally { setBusy(false); }
  };
  const wait = Math.max(0, Math.ceil((resendAt - Date.now()) / 1000));

  return (
    <div className="relative grid min-h-[100dvh] place-items-center overflow-hidden bg-bg px-4 py-16">
      <Stars count={70} seed={4} className="[mask-image:radial-gradient(ellipse_at_top,black_30%,transparent_75%)]" />
      <div className="relative w-full max-w-[400px]">
        <div className="relative z-0 flex justify-center">
          <span className="peek inline-flex translate-y-0"><Mascot color="blue" size={76} state="curious" track label="OpenMausBot" /></span>
        </div>
        <div className="enter relative z-10 -mt-5 rounded-card bg-card p-7 max-sm:p-6">
          <h1 className="text-20 font-medium tracking-[-0.01em] text-ink">{step === "email" ? "Sign in to your account" : "Check your email"}</h1>
          <p className="mt-1.5 text-14 leading-[1.5] text-ink-3">
            {step === "email" ? "Use the email of your OpenMausBot account. We send you a code." : <>We sent an 8-digit code to <span className="text-ink-2">{email.trim()}</span>.</>}
          </p>
          {note && <div className="mt-3 text-13 leading-[1.5] text-ink-2">{note}</div>}
          {step === "email" ? (
            <form className="mt-6" onSubmit={(e) => { e.preventDefault(); void send(); }}>
              <label htmlFor="email" className="mb-1.5 block text-13 text-ink-2">Email</label>
              <input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={field} aria-invalid={Boolean(error)} aria-describedby={error ? "signin-error" : undefined} />
              {error && <p id="signin-error" role="alert" className="mt-2 text-13 text-bad">{error}</p>}
              <Button type="submit" variant="primary" className="mt-5 w-full" disabled={busy || !email.trim()}>{busy ? "Sending code" : "Continue"}</Button>
            </form>
          ) : (
            <form className="mt-6" onSubmit={(e) => { e.preventDefault(); void verify(); }}>
              <label htmlFor="code" className="mb-1.5 block text-13 text-ink-2">Code</label>
              <input ref={codeRef} id="code" inputMode="numeric" autoComplete="one-time-code" required value={code} onChange={(e) => setCode(e.target.value.replace(/[^\d\s-]/g, "").slice(0, 12))} className={`${field} num tracking-[0.2em]`} aria-invalid={Boolean(error)} aria-describedby={error ? "signin-error" : undefined} />
              {error && <p id="signin-error" role="alert" className="mt-2 text-13 text-bad">{error}</p>}
              <Button type="submit" variant="primary" className="mt-5 w-full" disabled={busy || code.replace(/\D/g, "").length !== 8 || !attempt}>{busy ? "Checking" : "Sign in"}</Button>
              <div className="mt-4 flex items-center justify-between text-13">
                <button type="button" className="rounded-full px-1 text-ink-3 hover:text-ink-2" onClick={() => { setStep("email"); setError(null); }}>Use a different email</button>
                <button type="button" className="rounded-full px-1 text-ink-3 hover:text-ink-2 disabled:opacity-50" disabled={wait > 0 || busy} onClick={() => void send()}>{wait > 0 ? `Resend in ${wait} s` : "Send a new code"}</button>
              </div>
            </form>
          )}
        </div>
        <p className="mt-6 text-center text-13 text-ink-4">Your chats and files stay on your own machines.</p>
      </div>
    </div>
  );
}
