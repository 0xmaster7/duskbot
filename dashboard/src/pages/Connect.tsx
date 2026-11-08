import { useEffect, useState } from "react";
import { useSession } from "../data/session";
import { api } from "../lib/api";
import { navigate } from "../lib/router";
import { Button, ButtonLink, Card, PageHeader } from "../ui/kit";
import { Mascot } from "../ui/Mascot";
import { SkyEmpty, Stars } from "../ui/Sky";
import { APP_LINK } from "./Overview";

const CLAIM_KEY = "omb-dash-claim";

const STEPS = [
  { title: "Open OpenMausBot", body: "On your Mac. For a VPS, switch to it in the app's sidebar first: each workspace connects itself." },
  { title: "Choose Account dashboard", body: "It is in the account menu at the bottom of the sidebar, or in Settings on the mobile app." },
  { title: "Approve it here", body: "Your browser opens this dashboard with the workspace ready to connect. One click and it starts reporting." },
];

export function ConnectPage() {
  return (
    <div>
      <PageHeader title="Connect a workspace" sub="A workspace is one place your bots run: your Mac, or a VPS. Connect as many as you have." />
      <Card className="relative overflow-hidden">
        <Stars count={18} seed={9} className="left-1/2 [mask-image:linear-gradient(to_left,black,transparent)]" />
        <ol className="relative flex flex-col gap-6">
          {STEPS.map((s, i) => (
            <li key={s.title} className="flex gap-4">
              <span className="num grid size-8 shrink-0 place-items-center rounded-full border border-line-2 text-13 text-ink-2" aria-hidden>{i + 1}</span>
              <div className="pt-1">
                <div className="text-14 font-medium text-ink">{s.title}</div>
                <p className="mt-1 max-w-[56ch] text-14 leading-[1.55] text-ink-3">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
        <div className="relative mt-8 flex flex-wrap gap-2">
          <ButtonLink to={APP_LINK} external variant="primary">Open the app</ButtonLink>
          <ButtonLink to="/">Back to overview</ButtonLink>
        </div>
      </Card>
    </div>
  );
}

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
  if (error && !token) return <SkyEmpty title="Nothing to connect" action={<ButtonLink to="/connect">How to connect</ButtonLink>}>{error}</SkyEmpty>;
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
