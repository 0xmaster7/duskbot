import { AccountGate } from "./components/account-gate/AccountGate";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import {
  BROWSER_SIGN_IN_FAILED, previewBrowserSignIn, readSessionState, SERVICE_TRUST_REASON, takeBrowserSignInFromLocation, takePairingCodeFromLocation, takeInvitedEmailFromLocation,
} from "./lib/session";
import { productName } from "./lib/brand";
import { loadPageLanguage } from "./lib/language-preference";
import { applySkinChoice, readSkinChoice } from "./lib/skins";
import { applyChatWidth, readChatWidth } from "./lib/chat-width";
import { applyFont, readFont } from "./lib/fonts";
import { watchFocusNav } from "./lib/focus-nav";
import { BrowserSignInPage } from "./pair/BrowserSignInPage";
import { PairPage } from "./pair/PairPage";
import { HomeScreen, SignedOutAtHome } from "./components/HomeScreen";
import { ReconnectScreen } from "./components/ReconnectScreen";
import { PageBoundary } from "./components/PageBoundary";
import { startBootReads } from "./state/boot-reads";
import { endedBeforeReload, forgetEndedSession, SESSION_ENDED_REASON } from "./lib/session-ended";
import "./font-faces";
import "./styles.css";
import "./styles/overlays.css";
import "./styles/motion.css";

// Before first paint.
applySkinChoice(readSkinChoice());
applyFont(readFont());
applyChatWidth(readChatWidth());
watchFocusNav();

// The app is its own chunk, so these pages don't parse it. Everywhere else its fetch starts now, alongside the session
// read, instead of after it. A failed fetch renders as a throw, so PageBoundary offers a reload.
const PAGES_WITHOUT_THE_APP = new Set(["/home", "/reconnect", "/pair", "/desktop-viewer"]);
if (!PAGES_WITHOUT_THE_APP.has(location.pathname)) startBootReads();
const loadApp = () => import("./App").catch((error: unknown) => ({ default: (): never => { throw error; } }));
const appPage = PAGES_WITHOUT_THE_APP.has(location.pathname) ? null : loadApp();

async function chooseRoot(): Promise<React.ReactNode> {
  const home = window.ogb?.home;
  if (location.pathname === "/home" && home) return <HomeScreen bridge={home} manage={window.ogb?.cloudPlan?.manage} />;
  const reconnect = window.ogb?.reconnect;
  if (location.pathname === "/reconnect" && reconnect) return <ReconnectScreen bridge={reconnect} />;
  if (location.pathname === "/pair") {
    const signIn = takeBrowserSignInFromLocation();
    if (signIn) {
      const preview = await previewBrowserSignIn(signIn);
      return preview ? <BrowserSignInPage credential={signIn} owner={preview.owner} /> : <PairPage initialCode={null} reason={BROWSER_SIGN_IN_FAILED} />;
    }
    return <PairPage initialCode={takePairingCodeFromLocation()} initialEmail={takeInvitedEmailFromLocation()} />;
  }
  const accountGate = window.ogb?.accountGate;
  if (!PAGES_WITHOUT_THE_APP.has(location.pathname) && accountGate && (await accountGate.state()).blocked) return <AccountGate bridge={accountGate} />;
  const session = await readSessionState();
  if (session.kind === "unauthenticated") {
    const pair = <PairPage initialCode={null} reason={endedBeforeReload() ? SESSION_ENDED_REASON : session.error} />;
    return home ? <SignedOutAtHome bridge={home} fallback={pair} /> : pair;
  }
  forgetEndedSession();
  if (session.kind === "loopback" && session.trust === "service") return <PairPage initialCode={null} reason={SERVICE_TRUST_REASON} />;
  if (location.pathname === "/desktop-viewer") {
    const { DesktopViewer } = await import("./components/DesktopViewer");
    return <DesktopViewer />;
  }
  const { default: App } = await (appPage ?? loadApp());
  return <App />;
}

document.title = productName();
void Promise.all([chooseRoot(), loadPageLanguage()]).then(([root]) => {
  createRoot(document.getElementById("root")!).render(<StrictMode><PageBoundary>{root}</PageBoundary></StrictMode>);
});
