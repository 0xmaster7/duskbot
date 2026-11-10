import { useEffect, useRef, useState, type ReactNode } from "react";
import type { AuthProviders, IdentityProvider } from "../data/contracts";
import { useSession } from "../data/session";
import { api, ApiError, FIXTURE } from "../lib/api";
import { Link, navigate, useLocation } from "../lib/router";
import { ProviderMark, PROVIDER_NAME } from "../ui/BrandMarks";
import { Button, cx } from "../ui/kit";
import { Mascot } from "../ui/Mascot";

const REASON: Record<string, string> = {
  wrong_code: "That code does not match. Check the newest email and try again.",
  expired: "That code expired. Send a new one.",
  invalid_email: "That does not look like an email address.",
  sso: "Your organization signs in through its own provider. Sign in from the app instead.",
  two_factor: "This account uses two-step sign-in. Sign in from the app instead.",
  signup_closed: "There is no account for this email yet. Create one instead.",
  device_limit: "This account has reached its device limit. Sign out somewhere else and try again.",
  rate_limited: "Too many tries. Wait a minute, then try again.",
  offline: "We could not be reached. Check your connection.",
};

const OAUTH: IdentityProvider[] = ["google", "apple", "x"];
const SUPPORT = "hello@dusk.bot";
const LINK_ATTEMPT = /^[A-Za-z0-9_-]{43}$/;

// ?error= after a provider sign-in that did not finish
const OAUTH_ERROR: Record<string, string> = {
  oauth_denied: "Sign-in was cancelled at the provider. Try again, or use your email.",
  oauth_failed: "The provider did not finish signing you in. Try again, or use your email.",
  oauth_expired: "That sign-in took too long. Start again.",
  provider_unavailable: "That sign-in option is not available right now. Use your email instead.",
  signup_closed: "New accounts are not open yet.",
  identity_taken: "That account is already linked to another Dusk Bot account. Sign in with it instead.",
};

type Mode = "signin" | "signup";

export function AuthScreen({ mode, note }: { mode: Mode; note?: ReactNode }) {
  const { setAccount } = useSession();
  const { query } = useLocation();
  const pending = query.get("pending");
  const next = query.get("next");
  // signed out on a page like /cloud/desktop?code= or /claim: come back to it after signing in
  const here = ["/sign-in", "/signup", "/welcome"].includes(window.location.pathname) ? "/" : `${window.location.pathname}${window.location.search}`;
  const home = next && next.startsWith("/") && !next.startsWith("//") ? next : here;
  // the one-time link of a "Can't sign in?" email: its code waits behind a click, so a mail scanner opening it signs nobody in
  const [linked] = useState(() => { const hash = new URLSearchParams(window.location.hash.slice(1)), a = hash.get("attempt"), c = hash.get("code"); return a && LINK_ATTEMPT.test(a) && c && /^\d{8}$/.test(c) ? { attempt: a, code: c } : null; });
  const [step, setStep] = useState<"start" | "code" | "recover">(linked ? "code" : "start");
  const [recovering, setRecovering] = useState(false);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState(linked?.code ?? "");
  const [length, setLength] = useState(linked ? linked.code.length : 6);
  const [attempt, setAttempt] = useState<string | null>(linked?.attempt ?? null);
  const [resendAt, setResendAt] = useState(0);
  const [busy, setBusy] = useState<IdentityProvider | null>(null);
  const [error, setError] = useState<string | null>(() => OAUTH_ERROR[query.get("error") ?? ""] ?? null);
  const [providers, setProviders] = useState<AuthProviders["providers"] | null>(null);
  const [, force] = useState(0);
  const codeRef = useRef<HTMLInputElement>(null);
  const signup = mode === "signup";

  useEffect(() => { api.authProviders().then((r) => setProviders(r.providers), () => setProviders([])); }, []);
  useEffect(() => { if (linked) window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}`); }, [linked]);
  useEffect(() => { if (step === "code") codeRef.current?.focus(); }, [step]);
  useEffect(() => {
    if (step !== "code" || Date.now() >= resendAt) return;
    const id = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [step, resendAt]);

  const reason = (e: unknown) => (e instanceof ApiError && e.code && REASON[e.code]) || (e as Error).message || "Sign-in did not work. Try again.";
  const enabled = (p: IdentityProvider) => providers === null ? true : providers.some((x) => x.id === p && x.enabled);
  const hidden = (p: IdentityProvider) => providers !== null && !providers.some((x) => x.id === p && (x.enabled || x.comingSoon));

  const send = async (recover = recovering) => {
    setBusy("email"); setError(null);
    try {
      const r = await api.start(email.trim(), mode, recover ? undefined : pending ?? undefined, recover);
      setAttempt(r.attempt); setLength(r.codeLength || 6); setResendAt(Date.now() + r.resendAfter * 1000); setStep("code"); setCode("");
    } catch (e) { setError(reason(e)); } finally { setBusy(null); }
  };
  const verify = async (value = code) => {
    if (!attempt) return;
    setBusy("email"); setError(null);
    try {
      const r = await api.verify(attempt, value.replace(/\D/g, ""));
      // a phone sign-in that needed an email goes back to the app with its one-time code
      if (r.redirect?.startsWith("duskbot://auth?")) { window.location.assign(r.redirect); return; }
      navigate(home, { replace: true }); setAccount(r.account);
    }
    catch (e) { setError(reason(e)); setCode(""); codeRef.current?.focus(); if (e instanceof ApiError && e.code === "expired") setAttempt(null); }
    finally { setBusy(null); }
  };
  const oauth = async (p: IdentityProvider) => {
    setError(null);
    if (!FIXTURE) { window.location.assign(api.oauthUrl(p, mode, { next: home })); return; }
    // fixtures have no provider page to bounce through: sign the demo account in
    setBusy(p);
    try { const s = await api.start("sid@duskbot.test", mode); const r = await api.verify(s.attempt, "123456"); navigate("/", { replace: true }); setAccount(r.account); }
    catch (e) { setError(reason(e)); } finally { setBusy(null); }
  };
  const wait = Math.max(0, Math.ceil((resendAt - Date.now()) / 1000));

  return (
    <div className="relative grid min-h-[100dvh] place-items-center overflow-hidden bg-bg px-4 py-14">
      <div className="w-full max-w-[360px]">
        <div className="mb-6"><Mascot color="blue" size={40} still label="Dusk Bot" /></div>
        <div>
          {step === "start" ? (
            <div key="start" className="step-in">
              <h1 className="t-title">{signup ? "Create your account" : "Sign in to Dusk Bot"}</h1>
              <p className="mt-1.5 text-14 leading-[1.5] text-ink-3">One account for the app, your phone and your cloud desktop.</p>
              {note && <div className="mt-3 text-13 leading-[1.5] text-ink-2">{note}</div>}
              {pending && <div className="mt-3 text-13 leading-[1.5] text-ink-2">One more step: your provider did not share an email, so enter the one you want to sign in with.</div>}
              <div className="mt-6 flex flex-col gap-2">
                {!pending && OAUTH.filter((p) => !hidden(p)).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => void oauth(p)}
                    disabled={busy !== null || !enabled(p)}
                    className="press hover-outline relative flex h-11 w-full items-center justify-center gap-2.5 rounded-full bg-card-2 text-14 font-medium text-ink disabled:opacity-45"
                  >
                    <span className="absolute start-4 grid size-5 place-items-center text-ink"><ProviderMark provider={p} size={18} /></span>
                    {busy === p ? "Signing in" : enabled(p) ? `Continue with ${PROVIDER_NAME[p]}` : `${PROVIDER_NAME[p]}, coming soon`}
                  </button>
                ))}
              </div>
              <div className={cx("my-5 flex items-center gap-3 text-13 text-ink-3", pending && "hidden")} aria-hidden><span className="h-px flex-1 bg-line" />or<span className="h-px flex-1 bg-line" /></div>
              <form onSubmit={(e) => { e.preventDefault(); setRecovering(false); void send(false); }} noValidate>
                <label htmlFor="email" className="mb-1.5 block text-13 text-ink-3">Email</label>
                <input id="email" type="email" autoComplete="email" inputMode="email" required value={email} onChange={(e) => { setEmail(e.target.value); setError(null); }} className="field" aria-invalid={Boolean(error)} aria-describedby={error ? "auth-error" : undefined} />
                {error && <p id="auth-error" role="alert" className="mt-2 text-13 text-bad">{error}</p>}
                <Button type="submit" variant="primary" className="mt-4 w-full !h-11" disabled={busy !== null || !email.trim()}>{busy === "email" ? "Sending code" : "Continue"}</Button>
              </form>
              {!signup && !pending && <button type="button" className="hover-link -ms-2 mt-2 h-11 rounded-full px-2 text-13 text-ink-3" onClick={() => { setStep("recover"); setError(null); }}>Can't sign in?</button>}
            </div>
          ) : step === "recover" ? (
            <form key="recover" className="step-in" onSubmit={(e) => { e.preventDefault(); setRecovering(true); void send(true); }} noValidate>
              <h1 className="t-title">Can't sign in?</h1>
              <p className="mt-1.5 text-14 leading-[1.5] text-ink-3">Enter the address you used. We email a sign-in link and a code, and say how that account signs in, even if you first used Google or Apple.</p>
              <label htmlFor="recover-email" className="mb-1.5 mt-6 block text-13 text-ink-3">Email</label>
              <input id="recover-email" type="email" autoComplete="email" inputMode="email" required value={email} onChange={(e) => { setEmail(e.target.value); setError(null); }} className="field" aria-invalid={Boolean(error)} aria-describedby={error ? "auth-error" : undefined} />
              {error && <p id="auth-error" role="alert" className="mt-2 text-13 text-bad">{error}</p>}
              <Button type="submit" variant="primary" className="mt-4 w-full !h-11" disabled={busy !== null || !email.trim()}>{busy === "email" ? "Sending" : "Email me a sign-in link"}</Button>
              <h2 className="mt-6 text-14 font-medium text-ink">Lost access to that email?</h2>
              <p className="mt-1 text-13 leading-[1.5] text-ink-3">If you linked Google or Apple, go back and continue with it. If not, write to <a href={`mailto:${SUPPORT}`} className="hover-link text-ink-2 underline decoration-line-2 underline-offset-4">{SUPPORT}</a> from any address with your receipt, and we move your account to a new one.</p>
              <button type="button" className="hover-link -ms-2 mt-3 h-11 rounded-full px-2 text-13 text-ink-3" onClick={() => { setStep("start"); setError(null); }}>Back to sign in</button>
            </form>
          ) : (
            <form key="code" className="step-in" onSubmit={(e) => { e.preventDefault(); void verify(); }}>
              <h1 className="t-title">{linked && !email ? "Sign in to Dusk Bot" : "Check your email"}</h1>
              <p className="mt-1.5 text-14 leading-[1.5] text-ink-3">{linked && !email ? "Your sign-in link is ready. It works once, for 10 minutes."
                : recovering ? <>If an account uses <span className="break-all text-ink-2">{email.trim()}</span>, we sent a link and a {length}-digit code. It works for 10 minutes.</>
                : <>We sent a {length}-digit code to <span className="break-all text-ink-2">{email.trim()}</span>. It works for 10 minutes.</>}</p>
              <label htmlFor="code" className="mb-1.5 mt-6 block text-13 text-ink-3">Code</label>
              <input
                ref={codeRef}
                id="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                value={code}
                maxLength={length}
                onChange={(e) => {
                  const v = e.target.value.replace(/\D/g, "").slice(0, length);
                  setCode(v); setError(null);
                  if (v.length === length && busy === null) void verify(v);
                }}
                className={cx("field num !h-14 text-center !text-[22px] tracking-[0.5em]")}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? "auth-error" : undefined}
              />
              {error && <p id="auth-error" role="alert" className="mt-2 text-13 text-bad">{error}</p>}
              <Button type="submit" variant="primary" className="mt-4 w-full !h-11" disabled={busy !== null || code.length !== length || !attempt}>{busy ? "Checking" : signup ? "Create account" : "Sign in"}</Button>
              <div className="mt-4 flex items-center justify-between gap-2 text-13">
                <button type="button" className="hover-link -ms-2 h-11 rounded-full px-2 text-ink-3" onClick={() => { setStep(recovering ? "recover" : "start"); setError(null); }}>Use another email</button>
                <button type="button" className="hover-link -me-2 h-11 rounded-full px-2 text-ink-3 disabled:opacity-50" disabled={wait > 0 || busy !== null || !email.trim()} onClick={() => void send()}><span className="num">{wait > 0 ? `Send again in ${wait} s` : "Send a new code"}</span></button>
              </div>
            </form>
          )}
        </div>
        <p className="mt-6 text-center text-13 text-ink-3">
          {signup ? <>Have an account? <Link to="/signin" className="hover-link text-ink-2 underline decoration-line-2 underline-offset-4">Sign in</Link></> : <>New to Dusk Bot? <Link to="/signup" className="hover-link text-ink-2 underline decoration-line-2 underline-offset-4">Create an account</Link></>}
        </p>
        <p className="mt-3 text-center text-13 leading-[1.5] text-ink-3">
          {signup ? <>By continuing you agree to the <a href="https://dusk.bot/terms" className="hover-link underline decoration-line-2 underline-offset-4">Terms</a> and <a href="https://dusk.bot/privacy" className="hover-link underline decoration-line-2 underline-offset-4">Privacy Policy</a>.</> : "Your chats and files stay on your own computers."}
        </p>
      </div>
    </div>
  );
}
