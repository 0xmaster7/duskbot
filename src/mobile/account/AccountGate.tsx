import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { MausAvatar } from "@/components/Avatar";
import { SignIn } from "@/components/account-gate/SignIn";
import { problemLine } from "@/components/cloud-buy/SignInScreen";
import { t } from "@/lib/i18n";
import { THEME_SKINS } from "@/lib/skins";
import type { OAuthProvider } from "../../../shared/account-api";
import { demoOn, enterDemo } from "../demo/demo-mode";
import { LEGAL_LINKS } from "../legal";
import { MARKS } from "../onboarding/AccountStep";
import { usePlatform, type MobilePlatform } from "../platform";
import { createMobileAccount, isAccountAuthUrl, type AuthResult, type CloudPairResult, type MobileAccount, type MobileCloud } from "./account-client";

type AccountContextValue = { account: MobileAccount | null; origin: string; signOut(): Promise<void>; enrollGrant(): Promise<{ enrollToken: string; dashboardUrl: string } | null>;
  clouds(): Promise<MobileCloud[] | null>; pairCloud(cloud: MobileCloud): Promise<CloudPairResult>; wakeCloud(): Promise<boolean> };
const AccountContext = createContext<AccountContextValue | null>(null);
export const useMobileAccount = () => useContext(AccountContext);

export function mobileAccountOrigin(native: boolean, params: URLSearchParams): string {
  const configured = import.meta.env.VITE_DUSK_ACCOUNT_ORIGIN;
  if (configured) return configured;
  const value = !native && params.get("accountOrigin");
  if (value) {
    try {
      const url = new URL(value);
      if (url.origin === value && !url.username && !url.password && (url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))) return value;
    } catch {}
  }
  return "https://dusk.bot";
}

/** The sign-in buttons a phone shows, of those the account service says work. App Store guideline 4.8: an iPhone app
 * that offers another company's sign-in offers Sign in with Apple too, so without Apple the iPhone app offers none of
 * them (the email code stays). Apple leads where it is offered. */
export function providersFor(kind: MobilePlatform["kind"], enabled: readonly OAuthProvider[]): OAuthProvider[] {
  if (kind !== "ios") return [...enabled];
  return enabled.includes("apple") ? ["apple", ...enabled.filter((provider) => provider !== "apple")] : [];
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

/** Apple's button rules: its mark beside the words, on a plain white or black fill. The others carry their mark only. */
const PROVIDER_MARKS = {
  apple: { icon: MARKS.apple, className: "border-transparent bg-[#f3f4f8] text-[#121212]" },
  google: { icon: MARKS.google },
  x: { icon: MARKS.x },
};

const QUIET_LINK = "min-h-11 rounded-full px-3 text-[13px] text-ink-secondary underline underline-offset-2 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";

export function AccountGate({ children }: { children: ReactNode }) {
  const platform = usePlatform();
  const params = new URLSearchParams(location.search);
  const wanted = platform.native ? import.meta.env.VITE_DUSK_ALLOW_SIGNED_OUT !== "1" : params.get("account") === "1";
  const origin = mobileAccountOrigin(platform.native, params);
  const client = useMemo(() => createMobileAccount({ platform, origin }), [platform, origin]);
  const [account, setAccount] = useState<MobileAccount | null>(null);
  const [demo, setDemo] = useState<boolean | null>(wanted ? null : false);
  const [restoring, setRestoring] = useState(wanted);
  const [problem, setProblem] = useState<string>();
  const pendingAuth = useRef<Promise<AuthResult> | null>(null);
  // the demo workspace needs no account: it is how someone looks around before they have one
  const required = wanted && demo === false;
  useEffect(() => {
    if (!wanted) return;
    let active = true;
    void demoOn(platform).then((on) => { if (active) setDemo(on); });
    return () => { active = false; };
  }, [platform, wanted]);
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
    if (wanted && !pendingAuth.current) void client.restore().then(value => { if (active && stamp === revision) setAccount(value); }).catch(() => {}).finally(() => { if (active) setRestoring(false); });
    else if (!pendingAuth.current) setRestoring(false);
    // signed out or deleted somewhere else (the website, another device): the app finds out when it comes back
    const stopResume = wanted ? platform.onResume?.(() => {
      if (pendingAuth.current || !client.account()) return;
      const resumed = revision;
      void client.restore().then(value => { if (active && resumed === revision) setAccount(value); }).catch(() => {});
    }) : undefined;
    return () => { active = false; stop?.(); stopResume?.(); };
  }, [client, platform, wanted]);
  const context = useMemo<AccountContextValue>(() => ({ account, origin,
    signOut: async () => { setAccount(null); setProblem(undefined); await client.signOut(); },
    enrollGrant: () => client.enrollGrant(),
    clouds: () => client.clouds(), pairCloud: cloud => client.pairCloud(cloud), wakeCloud: () => client.wakeCloud(),
  }), [account, origin, client]);
  if (wanted && (demo === null || (restoring && required))) return <div className="omb-mobile flex size-full items-center justify-center bg-app"><MausAvatar color="green" size={56} state="idle" animated={false} personality={false} /></div>;
  return <AccountContext value={context}>{required && !account ? <div data-skin={THEME_SKINS.dark} className="omb-mobile size-full bg-app text-ink"><SignIn mobile emailStart={email => client.emailStart(email)} emailVerify={code => client.emailVerify(code)} cancelEmail={async () => { client.cancelEmail(); }} browser={provider => { setProblem(undefined); return client.oauthStart(provider); }} onSignedIn={() => { setAccount(client.account()); setProblem(undefined); }} notice={problem}
    options={async () => ({ providers: providersFor(platform.kind, await client.providers()), recovery: false })} marks={PROVIDER_MARKS}>
    <div className="flex flex-col items-center gap-1 border-t border-ink/10 pt-4">
      <button type="button" onClick={() => void enterDemo(platform)} className="flex min-h-11 w-full flex-col items-center justify-center rounded-full border border-ink/15 px-5 py-2 text-[14px] font-medium outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink">
        {t("mobile.demo.try")}<span className="text-[12px] font-normal text-ink-secondary">{t("mobile.demo.tryDetail")}</span>
      </button>
      <p className="mt-2 text-center text-[12px] leading-5 text-ink-tertiary">{t("mobile.account.legal")}</p>
      <div className="flex gap-1">
        <button type="button" className={QUIET_LINK} onClick={() => void platform.openExternal(LEGAL_LINKS.terms)}>{t("mobile.settings.terms")}</button>
        <button type="button" className={QUIET_LINK} onClick={() => void platform.openExternal(LEGAL_LINKS.privacy)}>{t("mobile.settings.privacy")}</button>
      </div>
    </div>
  </SignIn></div> : children}</AccountContext>;
}
