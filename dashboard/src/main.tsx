import { lazy, StrictMode, Suspense, useEffect, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { SessionProvider, useSession } from "./data/session";
import { useLocation } from "./lib/router";
import { initTheme } from "./lib/theme";
import { ButtonLink } from "./ui/kit";
import { Shell } from "./ui/Shell";
import { SkyEmpty } from "./ui/Sky";
import { LoadingPage } from "./pages/common";
import { ClaimPage, ConnectPage, stashClaim } from "./pages/Connect";
import { OverviewPage } from "./pages/Overview";
import { SignInScreen } from "./pages/SignIn";
import "./app.css";

const BotsPage = lazy(() => import("./pages/Bots").then((m) => ({ default: m.BotsPage })));
const BotPage = lazy(() => import("./pages/Bots").then((m) => ({ default: m.BotPage })));
const MyCloudPage = lazy(() => import("./pages/MyCloud").then((m) => ({ default: m.MyCloudPage })));
const DevicesPage = lazy(() => import("./pages/Devices").then((m) => ({ default: m.DevicesPage })));
const UsagePage = lazy(() => import("./pages/Usage").then((m) => ({ default: m.UsagePage })));
const BillingPage = lazy(() => import("./pages/Billing").then((m) => ({ default: m.BillingPage })));
const SettingsPage = lazy(() => import("./pages/Settings").then((m) => ({ default: m.SettingsPage })));

initTheme();
stashClaim();

const TITLES: Record<string, string> = {
  "/": "Overview", "/bots": "Bots", "/cloud": "My Cloud", "/devices": "Devices", "/usage": "Usage", "/billing": "Billing",
  "/settings": "Settings", "/connect": "Connect a workspace", "/claim": "Connect a workspace",
};

function route(path: string): ReactNode {
  if (path === "/") return <OverviewPage />;
  if (path === "/bots") return <BotsPage />;
  const bot = /^\/bots\/([^/]+)$/.exec(path);
  if (bot) return <BotPage id={decodeURIComponent(bot[1]!)} />;
  if (path === "/cloud") return <MyCloudPage />;
  if (path === "/devices") return <DevicesPage />;
  if (path === "/usage") return <UsagePage />;
  if (path === "/billing") return <BillingPage />;
  if (path === "/settings") return <SettingsPage />;
  if (path === "/connect") return <ConnectPage />;
  if (path === "/claim") return <ClaimPage />;
  return <SkyEmpty title="Nothing lives here" action={<ButtonLink to="/" variant="primary">Go to overview</ButtonLink>}>There is no page at {path}. The sidebar has every page.</SkyEmpty>;
}

function App() {
  const { path } = useLocation();
  const { account } = useSession();
  useEffect(() => { document.title = `${TITLES[path] ?? (path.startsWith("/bots/") ? "Bot" : "OpenMausBot")} · OpenMausBot`; }, [path]);
  if (account === undefined) return <div className="min-h-[100dvh] bg-bg" aria-busy="true" />;
  if (account === null) return <SignInScreen note={path === "/claim" ? "Sign in to connect the workspace you opened this from." : undefined} />;
  return <Shell><Suspense fallback={<LoadingPage />}>{route(path)}</Suspense></Shell>;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SessionProvider>
      <App />
    </SessionProvider>
  </StrictMode>,
);
