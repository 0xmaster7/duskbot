import { lazy, StrictMode, Suspense, useEffect, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { CloudDataProvider, useCloud } from "./data/cloud";
import { SessionProvider, useSession } from "./data/session";
import { navigate, useLocation } from "./lib/router";
import { initTheme } from "./lib/theme";
import { ButtonLink } from "./ui/kit";
import { Shell } from "./ui/Shell";
import { SkyEmpty } from "./ui/Sky";
import { LoadingPage } from "./pages/common";
import { ClaimPage, stashClaim } from "./pages/Connect";
import { HomePage } from "./pages/Home";
import { AuthScreen } from "./pages/Auth";
import "./app.css";

const pages = {
  cloud: () => import("./pages/CloudDesktop"),
  workspaces: () => import("./pages/Workspaces"),
  bots: () => import("./pages/Bots"),
  connectors: () => import("./pages/Connectors"),
  usage: () => import("./pages/Usage"),
  billing: () => import("./pages/Billing"),
  account: () => import("./pages/Account"),
  device: () => import("./pages/DeviceApproval"),
  onboarding: () => import("./pages/Onboarding"),
};
const CloudDesktopPage = lazy(() => pages.cloud().then((m) => ({ default: m.CloudDesktopPage })));
const WorkspacesPage = lazy(() => pages.workspaces().then((m) => ({ default: m.WorkspacesPage })));
const WorkspacePage = lazy(() => pages.workspaces().then((m) => ({ default: m.WorkspacePage })));
const BotsPage = lazy(() => pages.bots().then((m) => ({ default: m.BotsPage })));
const BotPage = lazy(() => pages.bots().then((m) => ({ default: m.BotPage })));
const ConnectorsPage = lazy(() => pages.connectors().then((m) => ({ default: m.ConnectorsPage })));
const UsagePage = lazy(() => pages.usage().then((m) => ({ default: m.UsagePage })));
const BillingPage = lazy(() => pages.billing().then((m) => ({ default: m.BillingPage })));
const AccountPage = lazy(() => pages.account().then((m) => ({ default: m.AccountPage })));
const DeviceApprovalPage = lazy(() => pages.device().then((m) => ({ default: m.DeviceApprovalPage })));
const Onboarding = lazy(() => pages.onboarding().then((m) => ({ default: m.Onboarding })));

// once the first page is up, fetch the other pages in idle time so moving between them never waits on the network;
// connectors carries the 450 kB app catalogue and loads when opened
function prefetchPages() {
  const idle = window.requestIdleCallback ?? ((fn: () => void) => setTimeout(fn, 1200));
  idle(() => { for (const [name, load] of Object.entries(pages)) if (name !== "connectors") void load().catch(() => {}); });
}

initTheme();
stashClaim();

const TITLES: Record<string, string> = {
  "/": "Home", "/cloud": "Cloud desktop", "/workspaces": "Workspaces", "/bots": "Bots", "/connectors": "Connectors",
  "/billing": "Plans & billing", "/usage": "Usage", "/account": "Account", "/claim": "Connect a workspace", "/welcome": "Welcome",
  "/signin": "Sign in", "/sign-in": "Sign in", "/signup": "Create your account", "/cloud/desktop": "Approve sign-in",
};

// older links keep working
const MOVED: Record<string, string> = { "/settings": "/account", "/devices": "/account#devices", "/connect": "/workspaces#add", "/signin": "/", "/sign-in": "/", "/signup": "/" };

function route(path: string): ReactNode {
  if (path === "/") return <HomePage />;
  if (path === "/cloud") return <CloudDesktopPage />;
  if (path === "/workspaces") return <WorkspacesPage />;
  const ws = /^\/workspaces\/([^/]+)$/.exec(path);
  if (ws) return <WorkspacePage id={decodeURIComponent(ws[1]!)} />;
  if (path === "/bots") return <BotsPage />;
  const bot = /^\/bots\/([^/]+)$/.exec(path);
  if (bot) return <BotPage id={decodeURIComponent(bot[1]!)} />;
  if (path === "/connectors") return <ConnectorsPage />;
  if (path === "/billing") return <BillingPage />;
  if (path === "/usage") return <UsagePage />;
  if (path === "/account") return <AccountPage />;
  if (path === "/claim") return <ClaimPage />;
  if (path === "/cloud/desktop") return <DeviceApprovalPage />;
  return <SkyEmpty title="Nothing lives here" action={<ButtonLink to="/" variant="primary">Go home</ButtonLink>}>There is no page at {path}. The sidebar has every page.</SkyEmpty>;
}

function SignedIn() {
  const { path, query } = useLocation();
  useEffect(prefetchPages, []);
  const { account } = useCloud();
  const next = query.get("next");
  const moved = MOVED[path] && (path === "/sign-in" && next?.startsWith("/") && !next.startsWith("//") ? next : MOVED[path]);
  useEffect(() => { if (moved) navigate(moved, { replace: true }); }, [moved]);
  if (moved) return null;
  const onboard = path === "/welcome" || (account !== null && !account.profile.onboarded && path !== "/claim" && path !== "/cloud/desktop");
  if (onboard) return <Suspense fallback={<div className="min-h-[100dvh] bg-bg" aria-busy="true" />}><Onboarding /></Suspense>;
  return <Shell><Suspense fallback={<LoadingPage />}>{route(path)}</Suspense></Shell>;
}

function App() {
  const { path } = useLocation();
  const { account } = useSession();
  useEffect(() => { document.title = `${TITLES[path] ?? (path.startsWith("/bots/") ? "Bot" : path.startsWith("/workspaces/") ? "Workspace" : "OpenMausBot")} · OpenMausBot`; }, [path]);
  if (account === undefined) return <div className="min-h-[100dvh] bg-bg" aria-busy="true" />;
  if (account === null) return <AuthScreen mode={path === "/signup" ? "signup" : "signin"} note={path === "/claim" ? "Sign in to connect the workspace you opened this from." : path === "/cloud/desktop" ? "Sign in to finish signing in the desktop app." : undefined} />;
  return <SignedIn />;
}

function Root() {
  const { account } = useSession();
  return <CloudDataProvider signedIn={Boolean(account)}><App /></CloudDataProvider>;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SessionProvider>
      <Root />
    </SessionProvider>
  </StrictMode>,
);
