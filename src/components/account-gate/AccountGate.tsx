import { useEffect, useState } from "react";
import { MausAvatar } from "@/components/Avatar";
import { t } from "@/lib/i18n";
import type { AccountGateBridge, GateState } from "./bridge";
import { SignIn } from "./SignIn";

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
  return <SignIn emailStart={email => bridge.signInStart(email)} emailVerify={code => bridge.signInVerify(code)} cancelEmail={() => bridge.signInCancel()} browser={async provider => { setState(await bridge.browser(provider)); }} onSignedIn={() => { void bridge.state().then(setState); }} notice={state?.status === "reauth-required" && (state.message === "access-ended" || state.message === "expired") ? t("accountGate.ended") : undefined} />;
}
