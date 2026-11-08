import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { MausAvatar } from "@/components/Avatar";
import { SignIn } from "@/components/account-gate/SignIn";
import { problemLine } from "@/components/cloud-buy/SignInScreen";
import { t } from "@/lib/i18n";
import { usePlatform } from "../platform";
import { createMobileAccount, isAccountAuthUrl, type AuthResult, type MobileAccount } from "./account-client";

type AccountContextValue = { account: MobileAccount | null; signOut(): Promise<void>; enrollGrant(): Promise<{ enrollToken: string; dashboardUrl: string } | null> };
const AccountContext = createContext<AccountContextValue | null>(null);
export const useMobileAccount = () => useContext(AccountContext);

export function mobileAccountOrigin(native: boolean, params: URLSearchParams): string {
  const configured = import.meta.env.VITE_OMB_ACCOUNT_ORIGIN;
  if (configured) return configured;
  const value = !native && params.get("accountOrigin");
  if (value) {
    try {
      const url = new URL(value);
      if (url.origin === value && !url.username && !url.password && (url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))) return value;
    } catch {}
  }
  return "https://cloud.openmausbot.com";
}

function authProblem(result: AuthResult): string | undefined {
  if (!result || result.outcome === "signed-in") return;
  switch (result.outcome) {
    case "oauth_denied": return t("accountGate.oauthDenied");
    case "oauth_failed": return t("accountGate.oauthFailed");
    case "oauth_expired": case "invalid-state": return t("accountGate.oauthExpired");
    case "provider_unavailable": return t("accountGate.providerUnavailable");
    case "signup_closed": return t("cloudBuy.signIn.signupClosed");
    case "identity_taken": return t("accountGate.identityTaken");
    default: return problemLine(result.outcome, result.outcome === "wrong-code" ? result.triesLeft : null);
  }
}

export function AccountGate({ children }: { children: ReactNode }) {
  const platform = usePlatform();
  const params = new URLSearchParams(location.search);
  const required = platform.native ? import.meta.env.VITE_OMB_ALLOW_SIGNED_OUT !== "1" : params.get("account") === "1";
  const origin = mobileAccountOrigin(platform.native, params);
  const client = useMemo(() => createMobileAccount({ platform, origin }), [platform, origin]);
  const [account, setAccount] = useState<MobileAccount | null>(null);
  const [restoring, setRestoring] = useState(required);
  const [problem, setProblem] = useState<string>();
  const pendingAuth = useRef<Promise<AuthResult> | null>(null);
  useEffect(() => {
    let active = true;
    let revision = 0;
    const stamp = revision;
    const follow = (task: Promise<AuthResult>) => {
      void task.then(result => {
        if (active) { setAccount(client.account()); setProblem(authProblem(result)); setRestoring(false); }
      }).catch(() => { if (active) { setProblem(t("cloudBuy.signIn.failed")); setRestoring(false); } }).finally(() => {
        if (active && pendingAuth.current === task) pendingAuth.current = null;
      });
    };
    if (pendingAuth.current) { ++revision; follow(pendingAuth.current); }
    const stop = platform.onAppUrl?.(url => {
      if (!isAccountAuthUrl(url)) return false;
      ++revision;
      const task = client.handleAuthUrl(url);
      pendingAuth.current = task;
      follow(task);
      return true;
    });
    if (required && !pendingAuth.current) void client.restore().then(value => { if (active && stamp === revision) setAccount(value); }).catch(() => {}).finally(() => { if (active) setRestoring(false); });
    else if (!pendingAuth.current) setRestoring(false);
    return () => { active = false; stop?.(); };
  }, [client, platform, required]);
  const context = useMemo<AccountContextValue>(() => ({ account,
    signOut: async () => { setAccount(null); setProblem(undefined); await client.signOut(); },
    enrollGrant: () => client.enrollGrant(),
  }), [account, client]);
  if (restoring && required) return <div className="omb-mobile flex size-full items-center justify-center bg-app"><MausAvatar color="green" size={56} state="idle" animated={false} personality={false} /></div>;
  return <AccountContext value={context}>{required && !account ? <div data-skin="grok-dark" className="omb-mobile size-full bg-[#121212] text-ink"><SignIn mobile emailStart={email => client.emailStart(email)} emailVerify={code => client.emailVerify(code)} cancelEmail={async () => { client.cancelEmail(); }} browser={provider => { setProblem(undefined); return client.oauthStart(provider); }} onSignedIn={() => { setAccount(client.account()); setProblem(undefined); }} notice={problem} /></div> : children}</AccountContext>;
}
