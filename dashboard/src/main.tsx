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

const CloudDesktopPage = lazy(() => import("./pages/CloudDesktop").then((m) => ({ default: m.CloudDesktopPage })));
const WorkspacesPage = lazy(() => import("./pages/Workspaces").then((m) => ({ default: m.WorkspacesPage })));
const WorkspacePage = lazy(() => import("./pages/Workspaces").then((m) => ({ default: m.WorkspacePage })));
const BotsPage = lazy(() => import("./pages/Bots").then((m) => ({ default: m.BotsPage })));
const BotPage = lazy(() => import("./pages/Bots").then((m) => ({ default: m.BotPage })));
const ConnectorsPage = lazy(() => import("./pages/Connectors").then((m) => ({ default: m.ConnectorsPage })));
const BillingPage = lazy(() => import("./pages/Billing").then((m) => ({ default: m.BillingPage })));
const AccountPage = lazy(() => import("./pages/Account").then((m) => ({ default: m.AccountPage })));
const Onboarding = lazy(() => import("./pages/Onboarding").then((m) => ({ default: m.Onboarding })));

initTheme();
stashClaim();

const TITLES: Record<string, string> = {
  "/": "Home", "/cloud": "Cloud desktop", "/workspaces": "Workspaces", "/bots": "Bots", "/connectors": "Connectors",
  "/billing": "Plans & billing", "/account": "Account", "/claim": "Connect a workspace", "/welcome": "Welcome",
  "/signin": "Sign in", "/signup": "Create your account",
};

// older links keep working
const MOVED: Record<string, string> = { "/usage": "/billing", "/settings": "/account", "/devices": "/account#devices", "/connect": "/workspaces#add", "/signin": "/", "/signup": "/" };

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
  if (path === "/account") return <AccountPage />;
  if (path === "/claim") return <ClaimPage />;
  return <SkyEmpty title="Nothing lives here" action={<ButtonLink to="/" variant="primary">Go home</ButtonLink>}>There is no page at {path}. The sidebar has every page.</SkyEmpty>;
}

function SignedIn() {
  const { path } = useLocation();
  const { account } = useCloud();
  const moved = MOVED[path];
  useEffect(() => { if (moved) navigate(moved, { replace: true }); }, [moved]);
  if (moved) return null;
  const onboard = path === "/welcome" || (account !== null && !account.profile.onboarded && path !== "/claim");
  if (onboard) return <Suspense fallback={<div className="min-h-[100dvh] bg-bg" aria-busy="true" />}><Onboarding /></Suspense>;
  return <Shell><Suspense fallback={<LoadingPage />}>{route(path)}</Suspense></Shell>;
}

function App() {
  const { path } = useLocation();
  const { account } = useSession();
  useEffect(() => { document.title = `${TITLES[path] ?? (path.startsWith("/bots/") ? "Bot" : path.startsWith("/workspaces/") ? "Workspace" : "OpenMausBot")} · OpenMausBot`; }, [path]);
  if (account === undefined) return <div className="min-h-[100dvh] bg-bg" aria-busy="true" />;
  if (account === null) return <AuthScreen mode={path === "/signup" ? "signup" : "signin"} note={path === "/claim" ? "Sign in to connect the workspace you opened this from." : undefined} />;
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
