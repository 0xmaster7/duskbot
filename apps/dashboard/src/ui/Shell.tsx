import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowUpRight, Bot, ChartNoAxesColumn, Check, ChevronsUpDown, CircleUser, Cloud, CreditCard, House, LayoutGrid, LogOut, Menu, Monitor, Plus, X } from "@/icons";
import type { WorkspaceSummary } from "../../../../shared/dashboard-protocol";
import { cloudForWorkspace, useCloud } from "../data/cloud";
import type { CloudDesktop } from "../data/contracts";
import { useSession } from "../data/session";
import { api } from "../lib/api";
import { trackUpsell } from "../lib/analytics";
import { Link, navigate, useLocation } from "../lib/router";
import { RoutineUpsell } from "../pages/routine-upsell";
import { PlanSheet } from "../pages/plan-sheet";
import { Button, cx, FreshnessTag } from "./kit";
import { Mascot } from "./Mascot";
import { SITE_NAME, SITE_URL } from "../lib/site";
import mark from "../../favicon.svg";
import { useNow } from "../lib/now";
import { useToasts } from "../lib/toast";
import { CheerBot } from "./CheerBot";
import { AnimatePresence, EASE_OUT, GLIDE, m, PageIn, Pop, ToastStack } from "./motion";
import { useAccountUsage } from "../data/usage";
import { investedLine, investedNoteDue, markInvestedNote } from "../lib/fun";
import type { InvestedFacts } from "../../../../shared/cloud-upsell";

const ICON = { size: 18, strokeWidth: 1.75 } as const;

type NavItem = { to: string; label: string; icon: ReactNode };
const NAV: Array<{ label?: string; items: NavItem[] }> = [
  { items: [
    { to: "/", label: "home", icon: <House {...ICON} /> },
    { to: "/cloud", label: "dusk cloud", icon: <Cloud {...ICON} /> },
    { to: "/workspaces", label: "workspaces", icon: <Monitor {...ICON} /> },
    { to: "/bots", label: "bots", icon: <Bot {...ICON} /> },
    { to: "/connectors", label: "apps", icon: <LayoutGrid {...ICON} /> },
  ] },
  { label: "you", items: [
    { to: "/billing", label: "plans and billing", icon: <CreditCard {...ICON} /> },
    { to: "/usage", label: "usage", icon: <ChartNoAxesColumn {...ICON} /> },
    { to: "/account", label: "account", icon: <CircleUser {...ICON} /> },
  ] },
];

export const KIND_LABEL = (kind: string, cloud: CloudDesktop | null) => (cloud ? "dusk cloud" : kind === "vps" ? "your server" : kind === "mac" ? "mac" : kind === "linux" ? "linux" : "windows");

const active = (path: string, to: string) => (to === "/" ? path === "/" : path === to || path.startsWith(`${to}/`));

function useDismiss(open: boolean, close: () => void, ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) close(); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("pointerdown", down);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", down); document.removeEventListener("keydown", key); };
  }, [open, close, ref]);
}

function WorkspaceSwitcher({ onNavigate }: { onNavigate?: () => void }) {
  const { workspaces, workspace, pick } = useSession();
  const now = useNow();
  const { clouds } = useCloud();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(open, () => setOpen(false), ref);
  const choose = (w: WorkspaceSummary) => { pick(w.id); setOpen(false); onNavigate?.(); };
  return (
    <div ref={ref} className="relative">
      <button
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`workspace: ${workspace?.name ?? "none yet"}. switch workspace`}
        onClick={() => setOpen((o) => !o)}
        className="hover-btn flex w-full items-center gap-2.5 rounded-[18px] bg-btn px-3.5 py-2.5 text-start"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-14 font-medium text-ink">{workspace?.name ?? "no workspace yet"}</span>
          {workspace ? <FreshnessTag freshness={workspace.freshness} at={workspace.lastReportAt} now={now} className="!text-12" /> : <span className="text-12 text-ink-3">connect one from the app</span>}
        </span>
        <ChevronsUpDown size={16} strokeWidth={1.5} className="shrink-0 text-ink-3" aria-hidden />
      </button>
      <Pop open={open} className="pop absolute inset-x-0 top-full z-30 mt-1.5 origin-top rounded-[18px] bg-pop p-1.5" style={{ boxShadow: "var(--pop-shadow)" }}>
          {workspaces?.map((w) => (
            <button key={w.id} role="menuitemradio" aria-checked={w.id === workspace?.id} onClick={() => choose(w)} className="hover-ghost flex w-full items-center gap-2.5 rounded-[12px] px-2.5 py-2 text-start">
              <span className={cx("live-dot", w.freshness === "live" ? "text-good" : w.freshness === "recent" ? "text-warn" : "text-ink-4")} aria-hidden />
              <span className="min-w-0 flex-1 truncate text-14 text-ink">{w.name}</span>
              <span className="text-12 text-ink-3">{KIND_LABEL(w.kind, cloudForWorkspace(clouds, w.id))}</span>
              {w.id === workspace?.id && <Check size={15} strokeWidth={1.75} className="text-ink-2" aria-hidden />}
            </button>
          ))}
          <div className="h-2" aria-hidden />
          <button role="menuitem" onClick={() => { setOpen(false); navigate("/workspaces#add"); onNavigate?.(); }} className="hover-ghost flex w-full items-center gap-2.5 rounded-[12px] px-2.5 py-2 text-start text-14 text-ink-2">
            <Plus size={16} strokeWidth={1.75} aria-hidden /> add a workspace
          </button>
      </Pop>
    </div>
  );
}

function UserRow() {
  const { account, setAccount } = useSession();
  const { billing, catalog } = useCloud();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(open, () => setOpen(false), ref);
  if (!account) return null;
  const name = account.name || (account.email.split("@")[0] ?? account.email);
  const sel = billing?.subscription?.selection;
  const license = sel && sel.license !== "personal" ? catalog?.licenses.find((l) => l.id === sel.license)?.name : null;
  const plan = sel && sel.desktop !== "none" ? catalog?.bundles.find((b) => b.desktop === sel.desktop && b.id !== "team")?.name ?? "dusk cloud" : null;
  const label = (plan ? (license && plan !== "pro" ? `${plan} + work license` : plan) : license ? `${license} license` : "free").toLowerCase();
  return (
    <div ref={ref} className="relative">
      <Pop open={open} className="pop absolute inset-x-0 bottom-full z-30 mb-1.5 origin-bottom rounded-[18px] bg-pop p-1.5" style={{ boxShadow: "var(--pop-shadow)" }}>
          <div className="truncate px-2.5 py-2 text-13 text-ink-3">{account.email}</div>
          <button role="menuitem" onClick={() => { setOpen(false); navigate("/account"); }} className="hover-ghost flex w-full items-center gap-2.5 rounded-[12px] px-2.5 py-2 text-14 text-ink-2"><CircleUser size={16} strokeWidth={1.75} aria-hidden /> account</button>
          <a role="menuitem" href={SITE_URL} className="hover-ghost flex w-full items-center gap-2.5 rounded-[12px] px-2.5 py-2 text-14 text-ink-2"><ArrowUpRight size={16} strokeWidth={1.75} aria-hidden /> {SITE_NAME}</a>
          <button role="menuitem" onClick={() => void api.signOut().finally(() => setAccount(null))} className="hover-ghost flex w-full items-center gap-2.5 rounded-[12px] px-2.5 py-2 text-14 text-ink-2"><LogOut size={16} strokeWidth={1.75} aria-hidden /> sign out</button>
      </Pop>
      <button aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="hover-side flex w-full items-center gap-3 rounded-[18px] px-2.5 py-2 text-start">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-ink text-14 font-medium lowercase text-bg" aria-hidden>{name.slice(0, 1)}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-14 text-ink">{name}</span>
          <span className="block truncate text-12 text-ink-3">{label}</span>
        </span>
        <ChevronsUpDown size={16} strokeWidth={1.5} className="shrink-0 text-ink-3" aria-hidden />
      </button>
    </div>
  );
}

function CloudBadge() {
  const { clouds } = useCloud();
  const c = clouds?.[0];
  if (!clouds) return null;
  if (!c) return null;
  const tone = c.status === "running" ? "text-good" : c.status === "provisioning" ? "text-accent" : c.status === "error" ? "text-bad" : "text-ink-4";
  return <span className={cx("live-dot ms-auto", tone)} data-live={c.status === "running"} aria-label={c.status === "running" ? "running" : c.status} role="img" />;
}

const HIDE_KEY = "dusk-dash-upsell-hidden-until";
const WEEK = 7 * 86_400_000;
// the invested copy holds the card for the rest of the visit it first showed in
let visitInvested: InvestedFacts | null = null;

/** the one nudge toward 24/7, for anyone without dusk cloud; hides for a week when closed */
function SideUpsell() {
  const { clouds } = useCloud();
  const [hiddenUntil, setHiddenUntil] = useState(() => Number(localStorage.getItem(HIDE_KEY) ?? 0));
  const [open, setOpen] = useState<"dash_sidebar" | "dash_invested" | null>(null);
  const visible = Boolean(clouds && !clouds.length && hiddenUntil <= Date.now());
  const hide = () => { const until = Date.now() + WEEK; localStorage.setItem(HIDE_KEY, String(until)); setHiddenUntil(until); };
  return (
    <>
      <AnimatePresence initial={false}>
        {visible && <SideUpsellCard key="upsell" onHide={hide} onOpen={setOpen} />}
      </AnimatePresence>
      <AnimatePresence>{open && <PlanSheet key="plan" source={open} start="starter" onClose={() => setOpen(null)} />}</AnimatePresence>
    </>
  );
}

/** the card itself, once the bots are counted: someone clearly invested gets it in their own numbers, once per account */
function SideUpsellCard({ onHide, onOpen }: { onHide: () => void; onOpen: (source: "dash_sidebar" | "dash_invested") => void }) {
  const { account, detail } = useSession();
  const { bots, loading } = useAccountUsage();
  const turns = detail?.report?.activity?.totals.turns ?? 0;
  const facts = useMemo(() => ({ bots: bots.length, messages: turns, routines: bots.reduce((sum, r) => sum + (r.bot.routines?.length ?? 0), 0) }), [bots, turns]);
  const [held, setHeld] = useState<InvestedFacts | null>(visitInvested);
  const shown = useRef(false);
  const ready = !loading || held !== null;
  const due = !shown.current && !held && ready && account ? investedNoteDue(account.id, facts, false) : false;
  const invested = held ?? (due ? facts : null);
  const source = invested ? "dash_invested" : "dash_sidebar";
  useEffect(() => {
    if (!ready || shown.current) return;
    shown.current = true;
    trackUpsell("shown", source);
    if (!due || !account) return;
    markInvestedNote(account.id);
    visitInvested = facts;
    setHeld(facts);
  }, [ready]);
  if (!ready) return null;
  return (
    <m.div className="pop relative rounded-[20px] bg-pop p-4" data-invested={invested ? "" : undefined} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.16, ease: EASE_OUT } }} transition={GLIDE}>
      <button type="button" onClick={() => { trackUpsell("dismiss", source); onHide(); }} aria-label="hide for a week" className="hover-ghost absolute right-1.5 top-1.5 grid size-8 place-items-center rounded-full text-ink-4 max-lg:size-11"><X size={14} strokeWidth={1.75} /></button>
      {invested ? (
        <div className="flex items-center gap-3 pe-6">
          <span className="shrink-0" aria-hidden><Mascot body="kit" color="blue" size={34} state="celebrate" tappable /></span>
          <div className="min-w-0">
            <h2 className="text-14 font-semibold leading-[1.3] text-ink">{investedLine(invested)}</h2>
            <p className="mt-0.5 text-13 font-medium leading-[1.4] text-ink-2">dusk cloud keeps them working 24/7, even when your mac is off.</p>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3 pe-6">
          <Mascot color="purple" body="wisp" size={34} state="sleeping" tappable />
          <p className="min-w-0 text-13 font-medium leading-[1.4] text-ink-2">dusk cloud keeps your bots working 24/7, even when your mac is off.</p>
        </div>
      )}
      <Button size="sm" variant="primary" className="mt-3.5 w-full" onClick={() => { trackUpsell("click", source); onOpen(source); }}>{invested ? "get dusk cloud" : "keep them on 24/7"}</Button>
    </m.div>
  );
}

function Nav({ onNavigate }: { onNavigate?: () => void }) {
  const { path } = useLocation();
  return (
    <nav aria-label="dashboard" className="flex flex-col gap-5">
      {NAV.map((group, i) => (
        <div key={i} className="flex flex-col gap-0.5">
          {group.label && <div className="t-meta px-3.5 pb-1.5">{group.label}</div>}
          {group.items.map((item) => {
            const on = active(path, item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                onClick={onNavigate}
                aria-current={on ? "page" : undefined}
                className={cx("relative flex h-10 items-center gap-3 rounded-full px-3.5 text-14 transition-colors duration-150", on ? "bg-pop font-medium text-ink" : "hover-side text-ink-2")}
              >
                <span className={cx("relative", on ? "text-ink" : "text-ink-3")}>{item.icon}</span>
                <span className="relative">{item.label}</span>
                {item.to === "/cloud" && <CloudBadge />}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

function Brand() {
  return (
    <Link to="/" className="flex items-center gap-2 rounded-full px-2.5 py-1" aria-label="dusk bot, home">
      <img src={mark} alt="" width={26} height={26} className="size-[26px]" />
      <span className="text-[17px] font-[550] tracking-[-0.02em] text-ink">dusk bot</span>
    </Link>
  );
}

function Toasts() {
  const toasts = useToasts();
  return <ToastStack items={toasts.map((t) => ({ id: t.id, className: "flex max-w-[440px] items-center gap-2.5 rounded-[22px] bg-primary px-4.5 py-3 text-14 text-primary-ink", content: <>{t.tone === "bad" && <span className="size-2 shrink-0 rounded-[2px] bg-[#ff6f66]" aria-hidden />}{t.text}</> }))} />;
}

const CLOUD_PICKED = "dusk-dash-cloud-picked";

/** a cloud someone just got becomes the picked workspace once; picking another one later sticks */
function usePickNewCloud() {
  const { clouds } = useCloud();
  const { workspaces, workspace, pick } = useSession();
  const cloud = clouds?.[0] ?? null, id = cloud?.workspaceId ?? null;
  const listed = id !== null && (workspaces ?? []).some((w) => w.id === id);
  useEffect(() => {
    if (!cloud || !id || !listed) return;
    try {
      if (localStorage.getItem(CLOUD_PICKED) === cloud.id) return;
      localStorage.setItem(CLOUD_PICKED, cloud.id);
    } catch { return; }
    if (workspace?.id !== id) pick(id);
  }, [cloud?.id, id, listed, workspace?.id, pick]);
}

export function Shell({ children }: { children: ReactNode }) {
  usePickNewCloud();
  const [drawer, setDrawer] = useState(false);
  const { path } = useLocation();
  useEffect(() => setDrawer(false), [path]);
  useEffect(() => {
    if (!drawer) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && setDrawer(false);
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [drawer]);
  const side = (close?: () => void) => (
    <div className="flex h-full flex-col gap-5 overflow-y-auto px-3 pb-3 pt-4">
      <div className="flex items-center justify-between">
        <Brand />
        {close && <button onClick={close} aria-label="close menu" className="press hover-ghost grid size-11 place-items-center rounded-full text-ink-2"><X size={18} strokeWidth={1.75} /></button>}
      </div>
      <WorkspaceSwitcher onNavigate={close} />
      <Nav onNavigate={close} />
      <div className="mt-auto flex flex-col gap-3"><SideUpsell /><UserRow /></div>
    </div>
  );
  return (
    <div className="min-h-[100dvh] bg-bg">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-full focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-ink">skip to content</a>
      <aside className="surface fixed inset-y-0 left-0 z-20 w-[276px] p-3 max-lg:hidden"><div className="h-full rounded-[28px] bg-side">{side()}</div></aside>
      <header className="sticky top-0 z-20 flex h-14 items-center justify-between bg-bg/90 px-3 backdrop-blur lg:hidden">
        <button onClick={() => setDrawer(true)} aria-label="open menu" aria-expanded={drawer} className="press hover-ghost grid size-11 place-items-center rounded-full text-ink-2"><Menu size={20} strokeWidth={1.75} /></button>
        <Brand />
        <span className="size-11" aria-hidden />
      </header>
      <AnimatePresence>
        {drawer && (
          <div key="drawer" className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="menu">
            <m.div className="absolute inset-0" style={{ background: "var(--scrim)" }} onClick={() => setDrawer(false)} aria-hidden initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2, ease: EASE_OUT }} />
            <m.div className="surface absolute inset-y-0 left-0 w-[min(304px,86vw)] rounded-e-[28px] bg-side" initial={{ x: "-100%", opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: "-100%", opacity: 0, transition: { type: "spring", visualDuration: 0.22, bounce: 0 } }} transition={GLIDE}>{side(() => setDrawer(false))}</m.div>
          </div>
        )}
      </AnimatePresence>
      <main id="main" className="lg:ps-[276px]">
        <PageIn key={path} id={path} className="mx-auto w-full max-w-[1120px] px-10 pb-24 pt-12 max-lg:px-6 max-lg:pt-6 max-sm:px-4">{children}</PageIn>
      </main>
      <RoutineUpsell />
      <CheerBot />
      <Toasts />
    </div>
  );
}
