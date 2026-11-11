import { lazy, StrictMode, Suspense, useEffect, type ComponentType, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { CloudDataProvider, useCloud } from "./data/cloud";
import { SessionProvider, useSession } from "./data/session";
import { navigate, useLocation } from "./lib/router";
import { initTheme } from "./lib/theme";
import { planIntent, planQuery } from "./lib/site";
import { reportPageErrors } from "./lib/page-errors";
import { Button, ButtonLink } from "./ui/kit";
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
reportPageErrors();
stashClaim();
stashDeleteToken();

const TITLES: Record<string, string> = {
  "/": "home", "/cloud": "dusk cloud", "/workspaces": "workspaces", "/bots": "bots", "/connectors": "connectors",
  "/billing": "plans and billing", "/usage": "usage", "/account": "account", "/claim": "connect a workspace", "/welcome": "welcome",
  "/signin": "sign in", "/sign-in": "sign in", "/signup": "make your account", "/cloud/desktop": "approve sign-in",
};

const SIGN_IN_PATHS = ["/signin", "/sign-in", "/signup"];

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
  return <SkyEmpty art="cat" title="nothing lives here." action={<ButtonLink to="/" variant="primary">go home</ButtonLink>}>there's no page at {path}. just gary.</SkyEmpty>;
}

function SignedIn() {
  const { path, query } = useLocation();
  useEffect(prefetchPages, []);
  const { account, error } = useCloud();
  const next = query.get("next");
  const intent = planIntent(query);
  const welcome = path === "/welcome";
  // a plan picked on the site: someone signed in already goes to the plan step, or straight to plans once onboarded
  const moved = MOVED[path]
    ? (intent && SIGN_IN_PATHS.includes(path) ? `/welcome?${planQuery(intent)}` : path === "/sign-in" && next?.startsWith("/") && !next.startsWith("//") ? next : MOVED[path])
    : welcome && intent && account?.profile.onboarded ? `/billing?${planQuery(intent)}` : null;
  useEffect(() => { if (moved) navigate(moved, { replace: true }); }, [moved]);
  if (moved) return null;
  const blank = <div className="min-h-[100dvh] bg-bg" aria-busy="true" />;
  if (welcome && intent && account === null && !error) return blank;
  const onboard = welcome || (account !== null && !account.profile.onboarded && path !== "/claim" && path !== "/cloud/desktop" && deletePageId(path) === null);
  if (onboard) return <Suspense fallback={blank}><Onboarding /></Suspense>;
  return <Shell><Suspense fallback={<LoadingPage />}>{route(path)}</Suspense></Shell>;
}

function App() {
  const { path } = useLocation();
  const { account, accountError, retryAccount } = useSession();
  useEffect(() => { document.title = `${TITLES[path] ?? (path.startsWith("/bots/") ? "bot" : path.startsWith("/workspaces/") ? "workspace" : deletePageId(path) !== null ? "delete cloud data" : "account")} · dusk bot`; }, [path]);
  if (accountError) return <main className="flex min-h-[100dvh] items-center justify-center bg-bg px-6"><SkyEmpty art="cat" title="can't reach your account right now." action={<Button variant="primary" onClick={retryAccount}>try again</Button>} className="w-full max-w-[520px]">check your connection. your bots are fine, they live on your own computers.</SkyEmpty></main>;
  if (account === undefined) return <div className="min-h-[100dvh] bg-bg" aria-busy="true" />;
  if (account === null) return <AuthScreen mode={path === "/signup" ? "signup" : "signin"} note={path === "/claim" ? "sign in to connect the workspace you opened this from." : path === "/cloud/desktop" ? "sign in to finish signing in the desktop app." : deleteSignInNote(path)} />;
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
