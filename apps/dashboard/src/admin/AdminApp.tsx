import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowUpRight, ChartNoAxesCombined, ChevronDown, Cloud, LayoutDashboard, Users } from "@/icons";
import { ButtonLink, cx } from "../ui/kit";
import { Modal } from "../ui/controls";
import { SkyEmpty } from "../ui/Sky";
import { Link, navigate, useLocation } from "../lib/router";
import { useToasts } from "../lib/toast";
import mark from "../../favicon.svg";
import { useAdmin } from "./api";
import { OverviewPage } from "./Overview";
import { SitePage } from "./Site";
import { FunnelPage } from "./Funnel";
import { PeoplePage } from "./People";
import { LivePage } from "./Live";
import { ProductPage } from "./Product";
import { UserPage, UsersPage } from "./Users";
import { CloudsPage } from "./Clouds";
import { WaitlistPage } from "./Waitlist";
import { EventsPage } from "./Events";
import { AuditPage, HealthPage } from "./Health";
import { Loading, Tabs } from "./ui";

const ICON = { size: 17, strokeWidth: 1.75 } as const;
const NAV = [
  { to: "/admin", key: "o", label: "overview", icon: <LayoutDashboard {...ICON} /> },
  { to: "/admin/people", key: "p", label: "people", icon: <Users {...ICON} />, also: ["/admin/users"] },
  { to: "/admin/product", key: "i", label: "product", icon: <ChartNoAxesCombined {...ICON} /> },
  { to: "/admin/clouds", key: "c", label: "clouds", icon: <Cloud {...ICON} /> },
];
const MORE = [
  { to: "/admin/analytics", key: "s", label: "site traffic" },
  { to: "/admin/live", key: "l", label: "live" },
  { to: "/admin/funnel", key: "f", label: "funnel" },
  { to: "/admin/events", key: "e", label: "events" },
  { to: "/admin/health", key: "h", label: "health" },
  { to: "/admin/audit", key: "a", label: "audit log" },
];
const ALL = [...NAV, ...MORE];
const PEOPLE_TABS = [{ to: "/admin/people", label: "accounts" }, { to: "/admin/people/visitors", label: "visitors" }, { to: "/admin/people/waitlist", label: "waitlist" }];
const MOVED: Record<string, string> = { "/admin/users": "/admin/people", "/admin/waitlist": "/admin/people/waitlist", "/admin/app": "/admin/product/apps", "/admin/retention": "/admin/product/retention" };
const on = (path: string, item: { to: string; also?: string[] }) => [item.to, ...(item.also ?? [])].some((to) => to === "/admin" ? path === "/admin" : path === to || path.startsWith(`${to}/`));

function page(path: string): ReactNode {
  if (path === "/admin") return <OverviewPage />;
  if (path.startsWith("/admin/people")) {
    const tabs = <Tabs label="people views" items={PEOPLE_TABS} />;
    if (path === "/admin/people/visitors") return <PeoplePage tabs={tabs} />;
    if (path === "/admin/people/waitlist") return <WaitlistPage tabs={tabs} />;
    if (path === "/admin/people") return <UsersPage tabs={tabs} />;
  }
  const user = /^\/admin\/users\/([^/]+)$/.exec(path);
  if (user) return <UserPage id={decodeURIComponent(user[1]!)} />;
  if (path === "/admin/product" || path.startsWith("/admin/product/")) return <ProductPage path={path} />;
  if (path === "/admin/clouds") return <CloudsPage />;
  if (path === "/admin/analytics") return <SitePage />;
  if (path === "/admin/funnel") return <FunnelPage />;
  if (path === "/admin/live") return <LivePage />;
  if (path === "/admin/events") return <EventsPage />;
  if (path === "/admin/health") return <HealthPage />;
  if (path === "/admin/audit") return <AuditPage />;
  return <SkyEmpty art="cat" title="no admin page here." action={<ButtonLink to="/admin" variant="primary">overview</ButtonLink>}>there's nothing at {path}.</SkyEmpty>;
}

/** g then a letter moves between pages, / finds, ? lists the keys; none of it fires while typing */
function useShortcuts(openHelp: () => void) {
  const pending = useRef<number>(0);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || target?.closest("input, textarea, select, [contenteditable=true], [role=dialog]")) return;
      if (e.key === "/") { const box = document.querySelector<HTMLInputElement>("[data-admin-search]"); if (box) { e.preventDefault(); box.focus(); } return; }
      if (e.key === "?") { e.preventDefault(); openHelp(); return; }
      if (e.key === "g") { pending.current = Date.now(); return; }
      if (Date.now() - pending.current < 1200) {
        const item = ALL.find((nav) => nav.key === e.key);
        pending.current = 0;
        if (item) { e.preventDefault(); navigate(item.to); }
      }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [openHelp]);
}

function Toasts() {
  const toasts = useToasts();
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-5 z-50 flex flex-col items-center gap-2 px-4">
      {toasts.map((t) => <div key={t.id} className="toast-in max-w-[440px] rounded-[22px] bg-primary px-4.5 py-3 text-14 text-primary-ink" style={{ boxShadow: "var(--pop-shadow)" }}>{t.text}</div>)}
    </div>
  );
}

export function AdminApp() {
  const { path } = useLocation();
  const me = useAdmin<{ admin: true; email: string; environment: string; version: string | null }>("/me");
  const [help, setHelp] = useState(false);
  useShortcuts(() => setHelp(true));
  const inMore = MORE.some((item) => on(path, item));
  const [moreOpen, setMoreOpen] = useState(inMore);
  useEffect(() => { document.title = `${ALL.find((item) => on(path, item))?.label ?? "admin"} · dusk bot admin`; }, [path]);
  useEffect(() => { const to = MOVED[path]; if (to) navigate(to, { replace: true }); }, [path]);
  if (me.error) {
    return (
      <main className="flex min-h-[100dvh] items-center justify-center bg-bg px-6">
        <SkyEmpty art="cat" title={me.error.status === 403 ? "this page is for the owner." : "can't open the admin panel."} action={<ButtonLink to="/" variant="primary">back to your account</ButtonLink>}>
          {me.error.status === 403 ? "your account isn't on the admin list." : me.error.message}
        </SkyEmpty>
      </main>
    );
  }
  return (
    <div className="min-h-[100dvh] bg-bg">
      <a href="#admin-main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-full focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-ink">skip to content</a>
      <aside className="fixed inset-y-0 left-0 z-20 flex w-[232px] flex-col gap-6 border-e border-line bg-bg px-3 pb-4 pt-5 max-lg:hidden">
        <Link to="/admin" className="flex items-center gap-2 rounded-full px-2.5 py-1" aria-label="dusk bot admin, overview">
          <img src={mark} alt="" width={24} height={24} className="size-6" />
          <span className="text-[16px] font-[550] tracking-[-0.02em] text-ink">dusk bot</span>
          <span className="tag !h-[22px] !px-2">admin</span>
        </Link>
        <nav aria-label="admin" className="flex flex-col gap-0.5">
          {NAV.map((item) => {
            const active = on(path, item);
            return (
              <Link key={item.to} to={item.to} aria-current={active ? "page" : undefined} className={cx("flex h-9 items-center gap-3 rounded-full px-3 text-14", active ? "bg-card font-medium text-ink" : "hover-side text-ink-2")}>
                <span className={active ? "text-ink" : "text-ink-3"} aria-hidden>{item.icon}</span>
                <span className="flex-1">{item.label}</span>
                <kbd className="t-meta !text-[11px] !text-ink-4" aria-hidden>g {item.key}</kbd>
              </Link>
            );
          })}
          <button type="button" aria-expanded={moreOpen || inMore} aria-controls="admin-more" onClick={() => setMoreOpen((v) => !v)}
            className="hover-side mt-3 flex h-8 items-center gap-2 rounded-full px-3 text-13 text-ink-3">
            more <ChevronDown size={14} strokeWidth={1.75} aria-hidden className={cx("transition-transform duration-150", (moreOpen || inMore) && "rotate-180")} />
          </button>
          {(moreOpen || inMore) && (
            <ul id="admin-more" className="flex flex-col gap-0.5">
              {MORE.map((item) => {
                const active = on(path, item);
                return (
                  <li key={item.to}>
                    <Link to={item.to} aria-current={active ? "page" : undefined} className={cx("flex h-8 items-center rounded-full px-3 text-13", active ? "bg-card font-medium text-ink" : "hover-side text-ink-3")}>
                      <span className="flex-1">{item.label}</span><kbd className="t-meta !text-[11px] !text-ink-4" aria-hidden>g {item.key}</kbd>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </nav>
        <div className="mt-auto flex flex-col gap-1 px-1">
          {me.data && <span className="truncate px-2 text-12 text-ink-3" title={me.data.email}>{me.data.email}</span>}
          {me.data && <span className="t-meta px-2 !text-[11.5px]">{me.data.environment} · {me.data.version ?? "dev"}</span>}
          <button type="button" onClick={() => setHelp(true)} className="hover-ghost mt-2 flex h-9 items-center rounded-full px-2 text-13 text-ink-3">keyboard shortcuts <kbd className="t-meta ms-auto !text-[11px]">?</kbd></button>
          <Link to="/" className="hover-ghost flex h-9 items-center gap-2 rounded-full px-2 text-13 text-ink-3"><ArrowUpRight size={15} strokeWidth={1.75} aria-hidden /> your account</Link>
        </div>
      </aside>
      <header className="sticky top-0 z-20 border-b border-line bg-bg/95 backdrop-blur lg:hidden">
        <div className="flex h-12 items-center justify-between px-4">
          <Link to="/admin" className="flex items-center gap-2" aria-label="dusk bot admin, overview"><img src={mark} alt="" width={22} height={22} className="size-[22px]" /><span className="text-[15px] font-[550] tracking-[-0.02em]">dusk bot</span><span className="tag !h-[22px] !px-2">admin</span></Link>
          <Link to="/" className="hover-link text-13 text-ink-3">your account</Link>
        </div>
        <nav aria-label="admin" className="scroll-x flex gap-1 px-3 pb-2">
          {ALL.map((item, i) => (
            <Link key={item.to} to={item.to} aria-current={on(path, item) ? "page" : undefined}
              className={cx("inline-flex h-9 shrink-0 items-center rounded-full px-3.5 text-13", i === NAV.length && "ms-2", on(path, item) ? "bg-card font-medium text-ink" : i < NAV.length ? "text-ink-2" : "text-ink-4")}>{item.label}</Link>
          ))}
        </nav>
      </header>
      <main id="admin-main" className="lg:ps-[232px]">
        <div key={path} className="page-in mx-auto w-full max-w-[1280px] px-10 pb-24 pt-10 max-lg:px-5 max-lg:pt-6 max-sm:px-4">
          {me.data ? page(path) : <Loading rows={8} />}
        </div>
      </main>
      <Modal open={help} onClose={() => setHelp(false)} title="keyboard shortcuts">
        <ul className="mt-2 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-14">
          {ALL.map((item) => <li key={item.key} className="contents"><kbd className="font-mono text-ink">g {item.key}</kbd><span>{item.label}</span></li>)}
          <li className="contents"><kbd className="font-mono text-ink">/</kbd><span>search this page</span></li>
          <li className="contents"><kbd className="font-mono text-ink">?</kbd><span>this list</span></li>
        </ul>
      </Modal>
      <Toasts />
    </div>
  );
}
