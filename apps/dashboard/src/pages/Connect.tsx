import { useEffect, useState } from "react";
import { useSession } from "../data/session";
import { api } from "../lib/api";
import { navigate } from "../lib/router";
import { Button, ButtonLink, Card } from "../ui/kit";
import { Mascot } from "../ui/Mascot";
import { SkyEmpty } from "../ui/Sky";

const CLAIM_KEY = "omb-dash-claim";

/** keeps a claim link's token across the sign-in round trip, out of the address bar */
export function stashClaim() {
  const m = /^#([A-Za-z0-9_-]{16,64})$/.exec(location.hash);
  if (m && location.pathname === "/claim") {
    sessionStorage.setItem(CLAIM_KEY, m[1]!);
    history.replaceState(null, "", "/claim");
  }
}

export function ClaimPage() {
  const { account, pick, refresh, toast } = useSession();
  const [token] = useState(() => sessionStorage.getItem(CLAIM_KEY));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (!token) setError("This link has no workspace in it. Open Account dashboard from the app again."); }, [token]);
  if (!account) return null;
  const claim = async () => {
    if (!token) return;
    setBusy(true); setError(null);
    try {
      const { workspace } = await api.claim(token);
      sessionStorage.removeItem(CLAIM_KEY);
      pick(workspace.id);
      refresh();
      toast(`${workspace.name} is connected`);
      navigate("/", { replace: true });
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(false); }
  };
  if (error && !token) return <SkyEmpty title="Nothing to connect" action={<ButtonLink to="/workspaces#add">How to connect</ButtonLink>}>{error}</SkyEmpty>;
  return (
    <div className="mx-auto max-w-[460px] pt-10">
      <div className="flex justify-center"><span className="peek inline-flex"><Mascot color="blue" size={64} state="happy" track /></span></div>
      <Card className="enter relative -mt-4">
        <h1 className="text-20 font-medium text-ink">Connect this workspace?</h1>
        <p className="mt-1.5 text-14 leading-[1.55] text-ink-3">It will report machine stats, bots, devices and usage totals to <span className="text-ink-2">{account.email}</span>. Chats and files stay on it.</p>
        {error && <p role="alert" className="mt-3 text-13 text-bad">{error}</p>}
        <div className="mt-6 flex gap-2">
          <Button variant="primary" onClick={() => void claim()} disabled={busy}>{busy ? "Connecting" : "Connect"}</Button>
          <Button onClick={() => { sessionStorage.removeItem(CLAIM_KEY); navigate("/", { replace: true }); }}>Not now</Button>
        </div>
      </Card>
    </div>
  );
}
