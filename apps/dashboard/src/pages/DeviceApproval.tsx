import { useEffect, useState } from "react";
import { Laptop } from "@/icons";
import { useSession } from "../data/session";
import { api, ApiError } from "../lib/api";
import { navigate, useLocation } from "../lib/router";
import { Button, ButtonLink, Card } from "../ui/kit";
import { Mascot } from "../ui/Mascot";
import { SkyEmpty } from "../ui/Sky";

type Device = { device: { name: string; platform: string }; userCode: string; expiresAt: number };

/** the desktop app's browser sign-in lands here: show which device asks, then approve or deny */
export function DeviceApprovalPage() {
  const { query } = useLocation();
  const { account, toast } = useSession();
  const code = query.get("code") ?? "";
  const [found, setFound] = useState<Device | null>(null);
  const [state, setState] = useState<"loading" | "ask" | "approved" | "denied" | "missing">("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!code) { setState("missing"); return; }
    api.deviceLookup(code).then((d) => { setFound(d); setState("ask"); }, (e) => { setState("missing"); setError(e instanceof ApiError && e.status !== 404 ? e.message : null); });
  }, [code]);

  const answer = async (yes: boolean) => {
    if (!found) return;
    setBusy(true); setError(null);
    try {
      if (yes) { await api.deviceApprove(found.userCode); setState("approved"); toast(`${found.device.name} is signed in`); }
      else { await api.deviceDeny(found.userCode); setState("denied"); }
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  if (state === "missing") {
    return <SkyEmpty title="that sign-in link has expired" action={<ButtonLink to="/" variant="primary">go home</ButtonLink>}>{error ?? "codes last 10 minutes. start the sign-in again from the app and it opens a fresh one."}</SkyEmpty>;
  }
  return (
    <div className="mx-auto max-w-[460px] pt-10 max-sm:pt-4">
      <div className="flex justify-center"><span className="peek inline-flex"><Mascot color="blue" size={64} state={state === "approved" ? "happy" : "curious"} track /></span></div>
      <Card className="enter relative -mt-4">
        {state === "loading" || !found ? (
          <p className="text-14 text-ink-3" aria-busy="true">looking up the device</p>
        ) : state === "approved" ? (
          <>
            <h1 className="text-20 font-medium text-ink">you are signed in</h1>
            <p className="mt-1.5 text-14 leading-[1.55] text-ink-3">go back to {found.device.name}. the app finishes on its own.</p>
            <Button className="mt-6" onClick={() => navigate("/", { replace: true })}>go to my dashboard</Button>
          </>
        ) : state === "denied" ? (
          <>
            <h1 className="text-20 font-medium text-ink">sign-in denied</h1>
            <p className="mt-1.5 text-14 leading-[1.55] text-ink-3">{found.device.name} was not signed in. if that was not you, nothing else is needed.</p>
          </>
        ) : (
          <>
            <h1 className="text-20 font-medium text-ink">sign in the app on this device?</h1>
            <div className="mt-4 flex items-center gap-3 rounded-[16px] bg-btn px-4 py-3">
              <Laptop size={18} strokeWidth={1.5} className="shrink-0 text-ink-2" aria-hidden />
              <div className="min-w-0">
                <div className="truncate text-14 text-ink">{found.device.name}</div>
                <div className="truncate text-13 text-ink-3">{found.device.platform} · code <span className="num">{found.userCode}</span></div>
              </div>
            </div>
            <p className="mt-3 text-13 leading-[1.5] text-ink-3">it signs in as <span className="text-ink-2">{account?.email}</span>. only approve if you started this from the app just now and the code matches.</p>
            {error && <p role="alert" className="mt-3 text-13 text-bad">{error}</p>}
            <div className="mt-6 flex gap-2">
              <Button variant="primary" onClick={() => void answer(true)} disabled={busy}>{busy ? "approving" : "approve"}</Button>
              <Button onClick={() => void answer(false)} disabled={busy}>deny</Button>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
