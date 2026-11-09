import { lazy, StrictMode, Suspense, useEffect, type ComponentType, type ReactNode } from "react";
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
import { deletePageId, deleteSignInNote, stashDeleteToken } from "./data/delete-data";
import { HomePage } from "./pages/Home";
import { AuthScreen } from "./pages/Auth";
import "./app.css";

type Page<P> = ComponentType<P> & { preload(): Promise<unknown> };

/** a page from its own chunk; once the chunk is in it renders straight away instead of suspending, which spares
 * later visits react's suspense reveal delay */
function page<M, P extends object>(load: () => Promise<M>, pick: (m: M) => ComponentType<P>): Page<P> {
  let loaded: ComponentType<P> | null = null;
  const take = (m: M) => (loaded = pick(m));
  const Lazy = lazy(() => load().then((m) => ({ default: take(m) })));
  return Object.assign((props: P) => {
    const Current = (loaded ?? Lazy) as ComponentType<P>;
    return <Current {...props} />;
  }, { preload: () => load().then(take) });
}

const CloudDesktopPage = page(() => import("./pages/CloudDesktop"), (m) => m.CloudDesktopPage);
const WorkspacesPage = page(() => import("./pages/Workspaces"), (m) => m.WorkspacesPage);
const WorkspacePage = page(() => import("./pages/Workspaces"), (m) => m.WorkspacePage);
const BotsPage = page(() => import("./pages/Bots"), (m) => m.BotsPage);
const BotPage = page(() => import("./pages/Bots"), (m) => m.BotPage);
const ConnectorsPage = page(() => import("./pages/Connectors"), (m) => m.ConnectorsPage);
const UsagePage = page(() => import("./pages/Usage"), (m) => m.UsagePage);
const BillingPage = page(() => import("./pages/Billing"), (m) => m.BillingPage);
const AccountPage = page(() => import("./pages/Account"), (m) => m.AccountPage);
const DeviceApprovalPage = page(() => import("./pages/DeviceApproval"), (m) => m.DeviceApprovalPage);
const DeleteDataPage = page(() => import("./pages/DeleteData"), (m) => m.DeleteDataPage);
const Onboarding = page(() => import("./pages/Onboarding"), (m) => m.Onboarding);

// after the first page has painted, fetch the others in idle time so moving between them never waits;
// connectors carries the 450 kB app catalogue and loads when opened
function prefetchPages() {
  const idle = window.requestIdleCallback ?? ((fn: () => void) => setTimeout(fn, 1));
  const timer = setTimeout(() => idle(() => {
    for (const p of [CloudDesktopPage, WorkspacesPage, WorkspacePage, BotsPage, BotPage, UsagePage, BillingPage, AccountPage, DeviceApprovalPage, Onboarding]) void p.preload().catch(() => {});
  }), 1500);
  return () => clearTimeout(timer);
}

initTheme();
stashClaim();
stashDeleteToken();

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
  const deleting = deletePageId(path);
  if (deleting !== null) return <DeleteDataPage id={deleting} />;
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
  const onboard = path === "/welcome" || (account !== null && !account.profile.onboarded && path !== "/claim" && path !== "/cloud/desktop" && deletePageId(path) === null);
  if (onboard) return <Suspense fallback={<div className="min-h-[100dvh] bg-bg" aria-busy="true" />}><Onboarding /></Suspense>;
  return <Shell><Suspense fallback={<LoadingPage />}>{route(path)}</Suspense></Shell>;
}

function App() {
  const { path } = useLocation();
  const { account } = useSession();
  useEffect(() => { document.title = `${TITLES[path] ?? (path.startsWith("/bots/") ? "Bot" : path.startsWith("/workspaces/") ? "Workspace" : deletePageId(path) !== null ? "Delete cloud data" : "Dusk Bot")} · Dusk Bot`; }, [path]);
  if (account === undefined) return <div className="min-h-[100dvh] bg-bg" aria-busy="true" />;
  if (account === null) return <AuthScreen mode={path === "/signup" ? "signup" : "signin"} note={path === "/claim" ? "Sign in to connect the workspace you opened this from." : path === "/cloud/desktop" ? "Sign in to finish signing in the desktop app." : deleteSignInNote(path)} />;
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
