import { useEffect, useState } from "react";
import { MausAvatar } from "@/components/Avatar";
import { t } from "@/lib/i18n";
import type { AccountGateBridge, GateState } from "./bridge";
import { SignIn } from "./SignIn";

/** Why the sheet is back: a session that ended, or a browser sign-in that came back without one. */
export function gateNotice(state: GateState | null): string | undefined {
  if (state?.status === "reauth-required") return state.message === "access-ended" || state.message === "expired" ? t("accountGate.ended") : undefined;
  if (state?.status !== "signed-out") return undefined;
  switch (state.message) {
    case "signin-cancelled": case "enrollment-ended": return t("accountGate.oauthDenied");
    case "enrollment-expired": return t("accountGate.oauthExpired");
    case "identity-taken": return t("accountGate.identityTaken");
    case "signup-closed": return t("cloudBuy.signIn.signupClosed");
    case "signin-failed": return t("accountGate.oauthFailed");
    default: return undefined;
  }
}

/** Signed out while the app is open: the page goes back to the sign-in, as after a restart. Switching accounts passes through
 * signed-out for a moment, so the state is read again before the page leaves. */
export function reloadWhenSignedOut(gate: AccountGateBridge, reload = () => location.reload(), settle = 1500): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const out = (state: GateState) => state.blocked && state.status === "signed-out";
  const stop = gate.onChange((next) => {
    clearTimeout(timer);
    if (out(next)) timer = setTimeout(() => void gate.state().then((now) => { if (out(now)) reload(); }, () => {}), settle);
  });
  return () => { clearTimeout(timer); stop(); };
}

export function AccountGate({ bridge }: { bridge: AccountGateBridge }) {
  const [state, setState] = useState<GateState | null>(null);
  useEffect(() => {
    let active = true;
    let changed = false;
    const update = (next: GateState) => {
      if (!active) return;
      setState(next);
      if (!next.blocked) location.reload();
    };
    const stop = bridge.onChange(next => { changed = true; update(next); });
    void bridge.state().then(next => { if (!changed) update(next); }).catch(() => {});
    return () => { active = false; stop(); };
  }, [bridge]);
  if (state?.status === "connecting" && state.enrollment) return <main className="flex size-full items-center justify-center bg-app px-6 text-ink">
    <div className="flex max-w-[360px] flex-col items-center gap-5 text-center">
      <MausAvatar color="green" size={80} state="idle" animated={false} personality={false} />
      <h1 className="text-[24px] font-semibold">{t("accountGate.browser")}</h1>
      <code dir="ltr" className="select-all font-mono text-[24px] tracking-widest">{state.enrollment.userCode}</code>
      <button type="button" className="ui-button ui-button-pill" onClick={() => void bridge.cancel().then(setState)}>{t("cloudAdd.cancel")}</button>
    </div>
  </main>;
  if (state?.status === "connecting" && state.browser) return <main className="flex size-full items-center justify-center bg-app px-6 text-ink">
    <div className="flex max-w-[360px] flex-col items-center gap-5 text-center">
      <MausAvatar color="green" size={80} state="idle" animated={false} personality={false} />
      <div><h1 className="text-[24px] font-semibold">{t("accountGate.browser")}</h1><p className="mt-2 text-[14px] leading-5 text-ink-secondary">{t("accountGate.browserBody")}</p></div>
      <div className="flex flex-col items-center gap-2">
        <button type="button" className="ui-button ui-button-pill" onClick={() => void bridge.reopen().then(setState)}>{t("accountGate.reopen")}</button>
        <button type="button" className="min-h-11 rounded-full px-3 text-[13px] text-ink-secondary underline underline-offset-2 outline-none hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink" onClick={() => void bridge.cancel().then(setState)}>{t("cloudAdd.cancel")}</button>
      </div>
    </div>
  </main>;
  return <SignIn options={bridge.options ? () => bridge.options!() : undefined} emailStart={(email, options) => options ? bridge.signInStart(email, options) : bridge.signInStart(email)} emailVerify={code => bridge.signInVerify(code)} cancelEmail={() => bridge.signInCancel()} browser={async provider => { setState(await bridge.browser(provider)); }} onSignedIn={() => { void bridge.state().then(setState); }} notice={gateNotice(state)} note={state?.plainStorage ? t("accountGate.plainStorage") : undefined} />;
}
