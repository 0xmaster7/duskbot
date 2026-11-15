import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowUpRight, Keyboard, Menu, Moon, Search, SlidersHorizontal, Sun, X } from "@/icons";
import { setTheme, useTheme } from "../lib/theme";
import { ButtonLink, cx } from "../ui/kit";
import { Modal } from "../ui/controls";
import { SkyEmpty } from "../ui/Sky";
import { Link, navigate, useLocation } from "../lib/router";
import { useToasts } from "../lib/toast";
import mark from "../../favicon.svg";
import { adminData, adminMoney, adminTests, MONEY_KEY, prefetchAdmin, setAdminData, setAdminTests, useAdmin } from "./api";
import { StagingTag } from "./DataSwitch";
import { OverviewPage } from "./Overview";
import { DetailsPage } from "./Details";
import { RetentionPage } from "./Retention";
import { PeoplePage } from "./People";
import { LivePage } from "./Live";
import { ProductPage } from "./Product";
import { RevenuePage } from "./RevenuePage";
import { CloudsPage } from "./Clouds";
import { WaitlistPage } from "./Waitlist";
import { EventsPage } from "./Events";
import { AuditPage, HealthPage } from "./Health";
import { OpsPage } from "./Ops";
import { AccountsUsagePage } from "./OpsAccounts";
import { FeedbackPage } from "./Feedback";
import { ExperiencePage } from "./Experience";
import { BugReportsPage } from "./BugReports";
import { InSection, Loading } from "./ui";
import { PersonSheetHost } from "./PersonSheet";
import { HomePage, homeReads } from "./Home";
import { rangeOf } from "./kit";
import { AccountsPage, accountReads } from "./Accounts";
import { PaymentsPage, paymentReads } from "./Payments";
import { AnimatePresence, EASE_OUT, m, Pop, ToastStack } from "../ui/motion";
import { currentItem, KEYS, MOVED, SECTIONS, type Section } from "./nav";
import { Highlight, SOFT } from "./motion";

export { currentItem };

function page(path: string): ReactNode {
  switch (path) {
    case "/admin": return <HomePage />;
    case "/admin/people": return <AccountsPage />;
    case "/admin/people/visitors": return <PeoplePage />;
    case "/admin/traffic": return <OverviewPage />;
    case "/admin/waitlist": return <WaitlistPage />;
    case "/admin/payments": return <PaymentsPage />;
    case "/admin/revenue": return <RevenuePage />;
    case "/admin/experience": return <ExperiencePage />;
    case "/admin/bug-reports": return <BugReportsPage />;
    case "/admin/feedback": return <FeedbackPage />;
    case "/admin/retention": return <RetentionPage />;
    case "/admin/clouds": return <CloudsPage />;
    case "/admin/ops": return <OpsPage />;
    case "/admin/ops/accounts": return <AccountsUsagePage />;
    case "/admin/live": return <LivePage />;
    case "/admin/health": return <HealthPage />;
    case "/admin/events": return <EventsPage />;
    case "/admin/audit": return <AuditPage />;
  }
  if (path === "/admin/product" || path.startsWith("/admin/product/")) return <ProductPage path={path} />;
  const details = /^\/admin\/analytics\/([a-z]+)$/.exec(path);
  if (details) return <DetailsPage dimension={details[1]!} />;
  return <SkyEmpty art="cat" title="nothing lives here." action={<ButtonLink to="/admin" variant="primary">home</ButtonLink>}>there's no admin page at {path}.</SkyEmpty>;
}

/** the reads a section's first view makes, started on hover or focus so the click lands on data */
const productReads = () => { const r = rangeOf("30d"); return [`/experience?from=${r.from}&to=${r.to}`, "/bug-reports", "/feedback"]; };
const WARM: Record<string, () => string[]> = { home: homeReads, people: accountReads, payments: paymentReads, product: productReads, ops: () => ["/clouds?status=live"] };
const warm = (id: string) => { for (const path of WARM[id]?.() ?? []) prefetchAdmin(path); };

const typing = (target: EventTarget | null) => !!(target as HTMLElement | null)?.closest?.("input, textarea, select, [contenteditable=true], [role=dialog]");
/** g then a letter moves, / finds, ? lists the keys; none of it fires while typing or in a dialog */
function useShortcuts(openHelp: () => void) {
  const pending = useRef(0);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
      if (e.key === "/") {
        e.preventDefault();
        const box = document.querySelector<HTMLInputElement>("[data-admin-search]");
        if (box) box.focus(); else navigate("/admin/people?find=1");
        return;
      }
      if (e.key === "?") { e.preventDefault(); openHelp(); return; }
      if (e.key === "g") { pending.current = Date.now(); return; }
      if (Date.now() - pending.current < 1200) {
        pending.current = 0;
        const hit = KEYS.find((k) => k.key === e.key);
        if (hit) { e.preventDefault(); navigate(hit.to); }
      }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [openHelp]);
}

function Toasts() {
  const toasts = useToasts();
  return <ToastStack items={toasts.map((t) => ({ id: t.id, className: "max-w-[440px] rounded-[22px] bg-primary px-4.5 py-3 text-14 text-primary-ink", content: t.text }))} />;
}

function Nav({ current, onGo }: { current: Section | null; onGo?: () => void }) {
  return (
    <nav aria-label="admin" className="relative flex flex-col gap-0.5">
      <Highlight target={current?.id ?? null} className="bg-pop" />
      {SECTIONS.map((section) => {
        const on = current === section;
        return (
          <Link key={section.id} to={section.tabs[0]!.to} data-hl={section.id} aria-current={on ? "page" : undefined} onClick={onGo}
            onPointerEnter={() => warm(section.id)} onFocus={() => warm(section.id)}
            className={cx("relative z-[1] flex h-9 items-center gap-3 rounded-full px-3 text-14 transition-colors duration-150 ease-out max-lg:h-11", on ? "font-medium text-ink" : "hover-side text-ink-2")}>
            <span className={cx("relative z-[1]", on ? "text-ink" : "text-ink-3")} aria-hidden>{section.icon}</span>
            <span className="relative z-[1] flex-1">{section.label}</span>
            <kbd aria-hidden className="relative z-[1] font-mono text-[11px] text-ink-4 max-lg:hidden">g {section.key}</kbd>
          </Link>
        );
      })}
    </nav>
  );
}

function SectionTabs({ section, path }: { section: Section; path: string }) {
  const on = currentItem(path)?.to ?? null;
  const strip = useRef<HTMLElement>(null);
  // on a narrow screen the strip scrolls, so the open view is scrolled into sight
  useEffect(() => {
    const nav = strip.current, item = nav?.querySelector<HTMLElement>("[aria-current=page]");
    if (nav && item && (item.offsetLeft < nav.scrollLeft || item.offsetLeft + item.offsetWidth > nav.scrollLeft + nav.clientWidth)) nav.scrollTo({ left: item.offsetLeft - 16 });
  }, [on]);
  if (section.tabs.length < 2) return null;
  return (
    <nav ref={strip} aria-label={`${section.label} views`} className="scroll-x -mx-1 mb-7 px-1 max-sm:mb-5">
      <div className="relative inline-flex gap-0.5 rounded-full bg-card p-1">
        <Highlight target={on} className="bg-pop" />
        {section.tabs.map((tab) => (
          <Link key={tab.to} to={tab.to} data-hl={tab.to} aria-current={on === tab.to ? "page" : undefined}
            className={cx("relative z-[1] inline-flex h-8 shrink-0 items-center whitespace-nowrap rounded-full px-3.5 text-13 transition-colors duration-150", on === tab.to ? "font-medium text-ink" : "text-ink-3 hover-link")}>
            {tab.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}

const MONEY_WORDS = { live: "live money", test: "test money", all: "live and test money" } as const;
/** what every number counts: whose analytics, which money, and whether test accounts are in. changes apply without a reload */
function ViewMenu({ live, onChange }: { live: string | null | undefined; onChange(): void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  const money = adminMoney(), tests = adminTests(), data = adminData();
  const setMoney = (v: "live" | "test" | "all") => { try { if (v === "live") localStorage.removeItem(MONEY_KEY); else localStorage.setItem(MONEY_KEY, v); } catch { /* private mode keeps live */ } onChange(); };
  const row = "flex items-center justify-between gap-3 px-3 py-2";
  const seg = (on: boolean) => cx("h-7 rounded-full px-2.5 text-12 transition-colors duration-150", on ? "bg-pop font-medium text-ink" : "text-ink-3 hover-link");
  return (
    <div ref={box} className="relative">
      <button type="button" aria-expanded={open} aria-haspopup="true" onClick={() => setOpen((v) => !v)}
        className="hover-ghost flex h-9 w-full items-center gap-2 rounded-full px-2.5 text-start text-13 text-ink-2 max-lg:h-11">
        <SlidersHorizontal size={15} strokeWidth={1.75} aria-hidden className="shrink-0 text-ink-3" />
        <span className="min-w-0 flex-1 truncate">{MONEY_WORDS[money]}{tests ? ", tests in" : ""}</span>
      </button>
      <Pop open={open} role="dialog" className="absolute bottom-full left-0 z-30 mb-2 w-[260px] origin-bottom-left rounded-[20px] bg-pop p-1.5 text-13" style={{ boxShadow: "var(--pop-shadow)" }}>
        <div aria-label="what the numbers count" className="flex flex-col">
          <div className={row}>
            <span id="view-money" className="text-ink-2">money</span>
            <div role="radiogroup" aria-labelledby="view-money" className="flex gap-0.5 rounded-full bg-card p-0.5">
              {(["live", "test", "all"] as const).map((v) => <button key={v} type="button" role="radio" aria-checked={money === v} onClick={() => setMoney(v)} className={seg(money === v)}>{v}</button>)}
            </div>
          </div>
          <label className={cx(row, "cursor-pointer")}>
            <span className="text-ink-2">test accounts</span>
            <input type="checkbox" checked={tests} onChange={(e) => { setAdminTests(e.target.checked); onChange(); }} className="size-4 cursor-pointer accent-[var(--accent)]" />
          </label>
          {live && (
            <div className={row}>
              <span id="view-data" className="text-ink-2">visits from</span>
              <div role="radiogroup" aria-labelledby="view-data" className="flex gap-0.5 rounded-full bg-card p-0.5">
                {([["live", live], ["own", "preview"]] as const).map(([v, label]) => <button key={v} type="button" role="radio" aria-checked={data === v} onClick={() => { setAdminData(v); onChange(); }} className={seg(data === v)}>{label}</button>)}
              </div>
            </div>
          )}
          <p className="px-3 pb-2 pt-1 text-12 leading-[1.5] text-ink-4">home always counts live money; test money shows next to it.</p>
        </div>
      </Pop>
    </div>
  );
}

export function AdminApp() {
  const { path, query } = useLocation();
  const me = useAdmin<{ admin: true; email: string; environment: string; version: string | null; live?: string | null }>("/me");
  const [help, setHelp] = useState(false);
  const [scope, setScope] = useState(0);
  const openHelp = useCallback(() => setHelp(true), []);
  useShortcuts(openHelp);
  const item = currentItem(path);
  const section = item?.section ?? null;
  const theme = useTheme();
  const dark = theme === "dark" || (theme === "system" && typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: dark)").matches);
  const [drawer, setDrawer] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  useEffect(() => setDrawer(false), [path]);
  useEffect(() => { if (wasOpen.current && !drawer) menuButton.current?.focus({ preventScroll: true }); wasOpen.current = drawer; }, [drawer]);
  useEffect(() => {
    if (!drawer) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && setDrawer(false);
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [drawer]);
  useEffect(() => { document.title = `${item && item.label !== section?.label ? `${item.label} / ` : ""}${section?.label ?? "admin"} / dusk bot admin`; }, [item, section]);
  useEffect(() => {
    const user = /^\/admin\/users\/([^/]+)$/.exec(path);
    const customer = query.get("customer");
    if (user) navigate(`/admin/people?person=${user[1]}`, { replace: true });
    else if (MOVED[path]) navigate(`${MOVED[path]}${query.size ? `?${query}` : ""}`, { replace: true });
    else if (customer) { const q = new URLSearchParams(query); q.delete("customer"); q.set("person", customer); navigate(`${path}?${q}`, { replace: true }); }
  }, [path, query]);
  // a new view starts at the top; opening a person sheet (same path) keeps the place
  useEffect(() => { window.scrollTo({ top: 0 }); }, [path]);
  // once home is up, the next places are warmed in the background so the first visit to them is instant
  useEffect(() => {
    if (!me.data) return;
    const idle = (globalThis as { requestIdleCallback?: (fn: () => void) => number }).requestIdleCallback ?? ((fn: () => void) => setTimeout(fn, 600));
    idle(() => { warm("home"); warm("people"); warm("payments"); warm("product"); });
  }, [me.data, scope]);

  const side = (close?: () => void) => (
    <>
      <div className="flex items-center justify-between">
        <Link to="/admin" className="flex items-center gap-2 rounded-full px-2.5 py-1" aria-label="dusk bot admin, home">
          <img src={mark} alt="" width={24} height={24} className="size-6" />
          <span className="text-[16px] font-[550] tracking-[-0.02em] text-ink">dusk bot</span>
          <span className="tag !h-[22px] !px-2">admin</span>
        </Link>
        {close && <button type="button" autoFocus onClick={close} aria-label="close menu" className="press hover-ghost -me-1 grid size-11 place-items-center rounded-full text-ink-2"><X size={18} strokeWidth={1.75} /></button>}
      </div>
      <button type="button" onClick={() => { close?.(); navigate("/admin/people?find=1"); }}
        className="hover-ghost -mt-2 flex h-9 items-center gap-2.5 rounded-full bg-card px-3 text-13 text-ink-3 max-lg:h-11">
        <Search size={15} strokeWidth={1.75} aria-hidden /><span className="flex-1 text-start">find a person</span><kbd aria-hidden className="font-mono text-[11px] text-ink-4 max-lg:hidden">/</kbd>
      </button>
      <Nav current={section} onGo={close} />
      <div className="mt-auto flex flex-col gap-0.5">
        {me.data && <ViewMenu live={me.data.live} onChange={() => setScope((v) => v + 1)} />}
        <button type="button" onClick={() => setTheme(dark ? "light" : "dark")} className="hover-ghost flex h-9 items-center gap-2 rounded-full px-2.5 text-13 text-ink-3 max-lg:h-11">{dark ? <Sun size={15} strokeWidth={1.75} aria-hidden /> : <Moon size={15} strokeWidth={1.75} aria-hidden />}{dark ? "light mode" : "dark mode"}</button>
        <button type="button" onClick={openHelp} className="hover-ghost flex h-9 items-center gap-2 rounded-full px-2.5 text-13 text-ink-3 max-lg:hidden"><Keyboard size={15} strokeWidth={1.75} aria-hidden />shortcuts<kbd aria-hidden className="ms-auto font-mono text-[11px] text-ink-4">?</kbd></button>
        <Link to="/" className="hover-ghost flex h-9 items-center gap-2 rounded-full px-2.5 text-13 text-ink-3 max-lg:h-11"><ArrowUpRight size={15} strokeWidth={1.75} aria-hidden />your account</Link>
        {me.data && <span className="truncate px-2.5 pt-1 font-mono text-[11px] text-ink-4" title={`${me.data.email}, ${me.data.environment} ${me.data.version ?? "dev"}`}>{me.data.environment} · {me.data.version ?? "dev"}</span>}
      </div>
    </>
  );

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
    <div className="min-h-[100dvh] bg-bg lg:grid lg:grid-cols-[220px_minmax(0,1fr)]">
      <a href="#admin-main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-full focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-ink">skip to content</a>
      <div className="bg-side max-lg:hidden">
        <aside className="sticky top-0 z-20 flex h-[100dvh] flex-col gap-6 overflow-y-auto overscroll-contain px-3 pb-4 pt-5">{side()}</aside>
      </div>
      <header className="sticky top-0 z-20 box-content flex h-14 items-center gap-1 bg-bg/95 px-3 pt-[env(safe-area-inset-top)] backdrop-blur lg:hidden">
        <button ref={menuButton} type="button" onClick={() => setDrawer(true)} aria-label="open menu" aria-expanded={drawer} className="press hover-ghost grid size-11 place-items-center rounded-full text-ink-2"><Menu size={20} strokeWidth={1.75} /></button>
        <Link to="/admin" className="flex min-w-0 items-center gap-2" aria-label="dusk bot admin, home"><img src={mark} alt="" width={22} height={22} className="size-[22px]" /><span className="text-[15px] font-[550] tracking-[-0.02em]">dusk bot</span><span className="tag !h-[22px] !px-2">admin</span></Link>
        <span className="flex-1" />
        <button type="button" onClick={() => navigate("/admin/people?find=1")} aria-label="find a person" className="press hover-ghost grid size-11 place-items-center rounded-full text-ink-2"><Search size={19} strokeWidth={1.75} /></button>
      </header>
      <AnimatePresence>
        {drawer && (
          <div key="drawer" className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="admin menu">
            <m.div className="absolute inset-0" style={{ background: "var(--scrim)" }} onClick={() => setDrawer(false)} aria-hidden initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2, ease: EASE_OUT }} />
            <m.div className="absolute inset-y-0 left-0 flex w-[min(280px,86vw)] flex-col gap-6 overflow-y-auto overscroll-contain rounded-e-[28px] bg-side px-3 pb-[max(16px,env(safe-area-inset-bottom))] pt-[max(16px,env(safe-area-inset-top))]"
              initial={{ x: "-100%" }} animate={{ x: 0 }} exit={{ x: "-100%", transition: { duration: 0.2, ease: EASE_OUT } }} transition={SOFT}>{side(() => setDrawer(false))}</m.div>
          </div>
        )}
      </AnimatePresence>
      <main id="admin-main" className="min-w-0">
        <div key={`${scope}`} className="mx-auto w-full max-w-[1280px] px-10 pb-24 pt-8 max-lg:px-5 max-lg:pt-4 max-sm:px-4">
          {me.data && <StagingTag environment={me.data.environment} live={me.data.live} />}
          {section && section.id !== "home" && (
            <>
              <h1 className="mb-4 text-[28px] font-medium leading-[1.15] tracking-[-0.04em] text-ink max-sm:text-[24px]">{section.label}</h1>
              <SectionTabs section={section} path={path} />
            </>
          )}
          <InSection.Provider value={!!section && section.id !== "home"}>
            {me.data ? page(path) : <Loading rows={8} />}
          </InSection.Provider>
        </div>
      </main>
      <Modal open={help} onClose={() => setHelp(false)} title="keyboard shortcuts" wide>
        <ul className="mt-2 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-14">
          {KEYS.map((k) => <li key={k.key} className="contents"><kbd className="font-mono text-ink">g {k.key}</kbd><span>{k.label}</span></li>)}
          <li className="contents"><kbd className="font-mono text-ink">/</kbd><span>search this page, or find a person</span></li>
          <li className="contents"><kbd className="font-mono text-ink">j k</kbd><span>move through people, enter opens one</span></li>
          <li className="contents"><kbd className="font-mono text-ink">?</kbd><span>this list</span></li>
        </ul>
      </Modal>
      {me.data && <PersonSheetHost />}
      <Toasts />
    </div>
  );
}
