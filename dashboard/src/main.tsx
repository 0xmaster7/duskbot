import { StrictMode, useEffect, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { DashboardProvider, useStore } from "./data/store";
import { scrollToHash, useLocation } from "./lib/router";
import { Shell } from "./ui/Shell";
import { Skeleton } from "./ui/kit";
import { EmptyState } from "./ui/Mascot";
import { ButtonLink } from "./ui/kit";
import { HomePage } from "./pages/Home";
import { BotPage, BotsPage } from "./pages/Bots";
import { MyCloudPage } from "./pages/MyCloud";
import { ComputersPage } from "./pages/Computers";
import { UsagePage } from "./pages/Usage";
import { BillingPage } from "./pages/Billing";
import { ProfilePage, SecurityPage } from "./pages/AccountSecurity";
import { ConnectionsPage, NotificationsPage, PrivacyPage } from "./pages/AccountMore";
import "./app.css";

const TITLES: Record<string, string> = {
  "/": "Home", "/bots": "Bots", "/cloud": "My Cloud", "/cloud/computers": "Bot computers", "/usage": "Usage", "/billing": "Billing",
  "/account/profile": "Profile", "/account/security": "Security & devices", "/account/connections": "Connections",
  "/account/notifications": "Notifications", "/account/privacy": "Data & privacy",
};

function route(path: string): ReactNode {
  if (path === "/") return <HomePage />;
  if (path === "/bots") return <BotsPage />;
  const bot = /^\/bots\/([^/]+)$/.exec(path);
  if (bot) return <BotPage id={decodeURIComponent(bot[1]!)} />;
  if (path === "/cloud") return <MyCloudPage />;
  if (path === "/cloud/computers") return <ComputersPage />;
  if (path === "/usage") return <UsagePage />;
  if (path === "/billing") return <BillingPage />;
  if (path === "/account" || path === "/account/profile") return <ProfilePage />;
  if (path === "/account/security") return <SecurityPage />;
  if (path === "/account/connections") return <ConnectionsPage />;
  if (path === "/account/notifications") return <NotificationsPage />;
  if (path === "/account/privacy") return <PrivacyPage />;
  return <EmptyState state="confused" title="This page wandered off" action={<ButtonLink to="/" variant="primary">Go home</ButtonLink>}>Nothing lives at {path}. The sidebar has every page.</EmptyState>;
}

function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading your dashboard">
      <Skeleton className="h-[230px] rounded-card" />
      <div className="mt-4 grid gap-4 md:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-[250px] rounded-card" />)}</div>
      <Skeleton className="mt-4 h-[200px] rounded-card" />
    </div>
  );
}

function App() {
  const { path } = useLocation();
  const { ready } = useStore();
  useEffect(() => { document.title = `${TITLES[path] ?? (path.startsWith("/bots/") ? "Bot" : "OpenMausBot")} · OpenMausBot`; }, [path]);
  useEffect(() => { if (window.location.hash) scrollToHash(window.location.hash.slice(1)); }, [path, ready]);
  return <Shell>{ready ? route(path) : <Loading />}</Shell>;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DashboardProvider>
      <App />
    </DashboardProvider>
  </StrictMode>,
);
