import { useEffect, useRef, useState, type ReactNode } from "react";
import { Blocks, Bot, ChartNoAxesColumn, Check, ChevronsUpDown, CircleUser, Cloud, CreditCard, House, Layers, LogOut, Menu, Plus, X } from "lucide-react";
import type { WorkspaceSummary } from "../../../shared/dashboard-protocol";
import { cloudForWorkspace, useCloud } from "../data/cloud";
import type { CloudDesktop } from "../data/contracts";
import { useSession } from "../data/session";
import { api } from "../lib/api";
import { Link, navigate, useLocation } from "../lib/router";
import { RoutineUpsell } from "../pages/routine-upsell";
import { PlanSheet } from "../pages/plan-sheet";
import { Button, cx, FreshnessTag } from "./kit";
import { Mascot } from "./Mascot";
import { useNow } from "../lib/now";
import { useToasts } from "../lib/toast";

const ICON = { size: 18, strokeWidth: 1.5 } as const;

type NavItem = { to: string; label: string; icon: ReactNode };
const NAV: Array<{ label?: string; items: NavItem[] }> = [
  { items: [
    { to: "/", label: "Home", icon: <House {...ICON} /> },
    { to: "/cloud", label: "Cloud desktop", icon: <Cloud {...ICON} /> },
    { to: "/workspaces", label: "Workspaces", icon: <Layers {...ICON} /> },
    { to: "/bots", label: "Bots", icon: <Bot {...ICON} /> },
    { to: "/connectors", label: "Connectors", icon: <Blocks {...ICON} /> },
  ] },
  { label: "Account", items: [
    { to: "/billing", label: "Plans & billing", icon: <CreditCard {...ICON} /> },
    { to: "/usage", label: "Usage", icon: <ChartNoAxesColumn {...ICON} /> },
    { to: "/account", label: "Account", icon: <CircleUser {...ICON} /> },
  ] },
];

export const KIND_LABEL = (kind: string, cloud: CloudDesktop | null) => (cloud ? "Cloud desktop" : kind === "vps" ? "Self-hosted VPS" : kind === "mac" ? "Mac" : kind === "linux" ? "Linux" : "Windows");

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
        aria-label={`Workspace: ${workspace?.name ?? "none yet"}. Switch workspace`}
        onClick={() => setOpen((o) => !o)}
        className="press-soft hover-side flex w-full items-center gap-2.5 rounded-row px-2.5 py-2 text-start"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-14 font-medium text-ink">{workspace?.name ?? "No workspace yet"}</span>
          {workspace ? <FreshnessTag freshness={workspace.freshness} at={workspace.lastReportAt} now={now} className="!text-12" /> : <span className="text-12 text-ink-3">Connect one from the app</span>}
        </span>
        <ChevronsUpDown size={16} strokeWidth={1.5} className="shrink-0 text-ink-3" aria-hidden />
      </button>
      {open && (
        <div role="menu" className="menu-in absolute inset-x-0 top-full z-30 mt-1 origin-top rounded-[14px] bg-card p-1.5" style={{ boxShadow: "var(--pop-shadow)" }}>
          {workspaces?.map((w) => (
            <button key={w.id} role="menuitemradio" aria-checked={w.id === workspace?.id} onClick={() => choose(w)} className="hover-ghost flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-start">
              <span className={cx("live-dot", w.freshness === "live" ? "text-good" : w.freshness === "recent" ? "text-warn" : "text-ink-4")} aria-hidden />
              <span className="min-w-0 flex-1 truncate text-14 text-ink">{w.name}</span>
              <span className="text-12 text-ink-3">{KIND_LABEL(w.kind, cloudForWorkspace(clouds, w.id))}</span>
              {w.id === workspace?.id && <Check size={15} strokeWidth={1.75} className="text-ink-2" aria-hidden />}
            </button>
          ))}
          <div className="my-1 h-px bg-line" />
          <button role="menuitem" onClick={() => { setOpen(false); navigate("/workspaces#add"); onNavigate?.(); }} className="hover-ghost flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-start text-14 text-ink-2">
            <Plus size={16} strokeWidth={1.5} aria-hidden /> Add a workspace
          </button>
        </div>
      )}
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
  const plan = sel && sel.desktop !== "none" ? catalog?.bundles.find((b) => b.desktop === sel.desktop && b.id !== "team")?.name ?? "Cloud desktop" : null;
  const label = plan ? (license && plan !== "Pro" ? `${plan} + work license` : plan) : license ? `${license} license` : "Free";
  return (
    <div ref={ref} className="relative">
      {open && (
        <div role="menu" className="menu-in absolute inset-x-0 bottom-full z-30 mb-1 origin-bottom rounded-[14px] bg-card p-1.5" style={{ boxShadow: "var(--pop-shadow)" }}>
          <div className="truncate px-2.5 py-2 text-13 text-ink-3">{account.email}</div>
          <button role="menuitem" onClick={() => { setOpen(false); navigate("/account"); }} className="hover-ghost flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-14 text-ink-2"><CircleUser size={16} strokeWidth={1.5} aria-hidden /> Account</button>
          <button role="menuitem" onClick={() => void api.signOut().finally(() => setAccount(null))} className="hover-ghost flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-14 text-ink-2"><LogOut size={16} strokeWidth={1.5} aria-hidden /> Sign out</button>
        </div>
      )}
      <button aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="press-soft hover-side flex w-full items-center gap-3 rounded-row px-2.5 py-2 text-start">
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-card-2 text-13 font-medium uppercase text-ink-2" aria-hidden>{name.slice(0, 1)}</span>
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
  if (!c) return <span className="t-pixel ms-auto rounded-full border border-line-2 px-2 py-px text-ink-3">24/7</span>;
  const tone = c.status === "running" ? "text-good" : c.status === "provisioning" ? "text-accent" : c.status === "error" ? "text-bad" : "text-ink-4";
  return <span className={cx("live-dot ms-auto", tone)} data-live={c.status === "running"} aria-label={c.status === "running" ? "Running" : c.status} role="img" />;
}

const HIDE_KEY = "omb-dash-upsell-hidden-until";
const WEEK = 7 * 86_400_000;

/** the one nudge toward 24/7, for anyone without a cloud desktop; hides for a week when closed */
function SideUpsell() {
  const { clouds } = useCloud();
  const { path } = useLocation();
  const [hiddenUntil, setHiddenUntil] = useState(() => Number(localStorage.getItem(HIDE_KEY) ?? 0));
  const [open, setOpen] = useState(false);
  if (!clouds || clouds.length || path === "/billing" || hiddenUntil > Date.now()) return open ? <PlanSheet source="dash_home" start="starter" onClose={() => setOpen(false)} /> : null;
  const hide = () => { const until = Date.now() + WEEK; localStorage.setItem(HIDE_KEY, String(until)); setHiddenUntil(until); };
  return (
    <div className="relative rounded-[14px] bg-card p-3.5">
      <button type="button" onClick={hide} aria-label="Hide for a week" className="hover-ghost absolute right-1 top-1 grid size-8 place-items-center rounded-full text-ink-4 max-lg:size-11"><X size={14} strokeWidth={1.5} /></button>
      <div className="flex items-start gap-3 pe-5">
        <Mascot color="silver" size={28} state="sleeping" />
        <p className="min-w-0 text-13 leading-[1.45] text-ink-2">Your bots stop when your Mac sleeps.</p>
      </div>
      <Button size="sm" variant="primary" className="mt-3 w-full" onClick={() => setOpen(true)}>Keep them on 24/7</Button>
      {open && <PlanSheet source="dash_home" start="starter" onClose={() => setOpen(false)} />}
    </div>
  );
}

function Nav({ onNavigate }: { onNavigate?: () => void }) {
  const { path } = useLocation();
  return (
    <nav aria-label="Dashboard" className="flex flex-col gap-5">
      {NAV.map((group, i) => (
        <div key={i} className="flex flex-col gap-0.5">
          {group.label && <div className="px-3 pb-1.5 text-12 text-ink-4">{group.label}</div>}
          {group.items.map((item) => {
            const on = active(path, item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                onClick={onNavigate}
                aria-current={on ? "page" : undefined}
                className={cx("press-soft flex h-10 items-center gap-3 rounded-row px-3 text-14", on ? "bg-card-2 text-ink" : "hover-side text-ink-2")}
              >
                <span className={on ? "text-ink" : "text-ink-3"}>{item.icon}</span>
                {item.label}
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
    <Link to="/" className="flex items-center gap-2.5 rounded-row px-2.5 py-1" aria-label="OpenMausBot, home">
      <Mascot color="blue" size={24} still />
      <span className="text-14 font-medium tracking-[-0.01em] text-ink">OpenMausBot</span>
    </Link>
  );
}

function Toasts() {
  const toasts = useToasts();
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-5 z-50 flex flex-col items-center gap-2 px-4">
      {toasts.map((t) => (
        <div key={t.id} className={cx("toast-in max-w-[440px] rounded-full bg-card px-4 py-2.5 text-13", t.tone === "bad" ? "text-bad" : "text-ink")} style={{ boxShadow: "var(--pop-shadow)" }}>{t.text}</div>
      ))}
    </div>
  );
}

export function Shell({ children }: { children: ReactNode }) {
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
    <div className="flex h-full flex-col gap-6 px-3 pb-3 pt-4">
      <div className="flex items-center justify-between">
        <Brand />
        {close && <button onClick={close} aria-label="Close menu" className="press hover-ghost grid size-11 place-items-center rounded-full text-ink-2"><X size={18} strokeWidth={1.5} /></button>}
      </div>
      <WorkspaceSwitcher onNavigate={close} />
      <Nav onNavigate={close} />
      <div className="mt-auto flex flex-col gap-3"><SideUpsell /><UserRow /></div>
    </div>
  );
  return (
    <div className="min-h-[100dvh] bg-bg">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-full focus:bg-card focus:px-4 focus:py-2">Skip to content</a>
      <aside className="fixed inset-y-0 left-0 z-20 w-[260px] bg-side max-lg:hidden">{side()}</aside>
      <header className="sticky top-0 z-20 flex h-14 items-center justify-between bg-bg/90 px-3 backdrop-blur lg:hidden">
        <button onClick={() => setDrawer(true)} aria-label="Open menu" aria-expanded={drawer} className="press hover-ghost grid size-11 place-items-center rounded-full text-ink-2"><Menu size={20} strokeWidth={1.5} /></button>
        <Brand />
        <span className="size-11" aria-hidden />
      </header>
      {drawer && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="fade-in absolute inset-0" style={{ background: "var(--scrim)" }} onClick={() => setDrawer(false)} aria-hidden />
          <div className="drawer-in absolute inset-y-0 left-0 w-[min(300px,86vw)] bg-side">{side(() => setDrawer(false))}</div>
        </div>
      )}
      <main id="main" className="lg:ps-[260px]">
        <div className="mx-auto w-full max-w-[1120px] px-12 pb-20 pt-12 max-lg:px-6 max-lg:pt-6 max-sm:px-4">{children}</div>
      </main>
      <RoutineUpsell />
      <Toasts />
    </div>
  );
}
