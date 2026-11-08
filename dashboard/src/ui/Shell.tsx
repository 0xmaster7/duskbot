import { useEffect, useRef, useState, type ReactNode } from "react";
import { Blocks, Bot, ChartNoAxesColumn, Check, ChevronsUpDown, CircleUser, Cloud, CreditCard, House, Layers, LogOut, Menu, Plus, X } from "lucide-react";
import type { WorkspaceSummary } from "../../../shared/dashboard-protocol";
import { cloudForWorkspace, useCloud } from "../data/cloud";
import type { CloudDesktop } from "../data/contracts";
import { useSession } from "../data/session";
import { api } from "../lib/api";
import { Link, navigate, useLocation } from "../lib/router";
import { cx } from "./kit";
import { Mascot } from "./Mascot";

const ICON = { size: 16, strokeWidth: 1.5 } as const;

type NavItem = { to: string; label: string; icon: ReactNode };
// one list, one quiet gap; the account lives in the row at the bottom
const NAV: NavItem[][] = [
  [
    { to: "/", label: "Home", icon: <House {...ICON} /> },
    { to: "/cloud", label: "Cloud desktop", icon: <Cloud {...ICON} /> },
    { to: "/workspaces", label: "Workspaces", icon: <Layers {...ICON} /> },
    { to: "/bots", label: "Bots", icon: <Bot {...ICON} /> },
    { to: "/connectors", label: "Connectors", icon: <Blocks {...ICON} /> },
  ],
  [
    { to: "/usage", label: "Usage", icon: <ChartNoAxesColumn {...ICON} /> },
    { to: "/billing", label: "Plans & billing", icon: <CreditCard {...ICON} /> },
  ],
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

const FRESH_TONE = { live: "text-good", recent: "text-warn", offline: "text-ink-4", waiting: "text-ink-4" } as const;
const MENU = "menu-in absolute inset-x-0 z-30 rounded-[12px] bg-card p-1";
const MENU_ITEM = "hover-ghost flex h-8 w-full items-center gap-2.5 rounded-[8px] px-2.5 text-start text-13 max-lg:h-11";

function WorkspaceSwitcher({ onNavigate }: { onNavigate?: () => void }) {
  const { workspaces, workspace, pick } = useSession();
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
        className="hover-side flex h-8 w-full items-center gap-2 rounded-row px-2.5 text-start max-lg:h-11"
      >
        <span className={cx("live-dot !size-1.5", workspace ? FRESH_TONE[workspace.freshness] : "text-ink-4")} aria-hidden />
        <span className="min-w-0 flex-1 truncate text-13 text-ink-2">{workspace?.name ?? "No workspace yet"}</span>
        <ChevronsUpDown size={14} strokeWidth={1.5} className="shrink-0 text-ink-4" aria-hidden />
      </button>
      {open && (
        <div role="menu" className={cx(MENU, "top-full mt-1 origin-top")} style={{ boxShadow: "var(--pop-shadow)" }}>
          {workspaces?.map((w) => (
            <button key={w.id} role="menuitemradio" aria-checked={w.id === workspace?.id} onClick={() => choose(w)} className={MENU_ITEM}>
              <span className={cx("live-dot !size-1.5", FRESH_TONE[w.freshness])} aria-hidden />
              <span className="min-w-0 flex-1 truncate text-ink">{w.name}</span>
              <span className="truncate text-12 text-ink-4">{KIND_LABEL(w.kind, cloudForWorkspace(clouds, w.id))}</span>
              <Check size={14} strokeWidth={1.75} className={cx("shrink-0 text-ink-2", w.id !== workspace?.id && "invisible")} aria-hidden />
            </button>
          ))}
          {workspaces?.length ? <div className="my-1 h-px bg-line" /> : null}
          <button role="menuitem" onClick={() => { setOpen(false); navigate("/workspaces#add"); onNavigate?.(); }} className={cx(MENU_ITEM, "text-ink-2")}>
            <Plus size={14} strokeWidth={1.5} aria-hidden /> Add a workspace
          </button>
        </div>
      )}
    </div>
  );
}

function UserRow({ onNavigate }: { onNavigate?: () => void }) {
  const { account, setAccount } = useSession();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { path } = useLocation();
  useDismiss(open, () => setOpen(false), ref);
  if (!account) return null;
  const name = account.name || (account.email.split("@")[0] ?? account.email);
  const on = path === "/account";
  return (
    <div ref={ref} className="relative">
      {open && (
        <div role="menu" className={cx(MENU, "bottom-full mb-1 origin-bottom")} style={{ boxShadow: "var(--pop-shadow)" }}>
          <div className="truncate px-2.5 py-1.5 text-12 text-ink-4">{account.email}</div>
          <button role="menuitem" onClick={() => { setOpen(false); navigate("/account"); onNavigate?.(); }} className={cx(MENU_ITEM, "text-ink-2")}><CircleUser size={14} strokeWidth={1.5} aria-hidden /> Account</button>
          <button role="menuitem" onClick={() => void api.signOut().finally(() => setAccount(null))} className={cx(MENU_ITEM, "text-ink-2")}><LogOut size={14} strokeWidth={1.5} aria-hidden /> Sign out</button>
        </div>
      )}
      <button aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} className={cx("hover-side flex h-10 w-full items-center gap-2.5 rounded-row px-2 text-start max-lg:h-11", on && "bg-card-2")}>
        <span className="grid size-6 shrink-0 place-items-center rounded-full bg-card-2 text-12 font-medium uppercase text-ink-2" aria-hidden>{name.slice(0, 1)}</span>
        <span className="min-w-0 flex-1 truncate text-13 text-ink-2">{name}</span>
        <ChevronsUpDown size={14} strokeWidth={1.5} className="shrink-0 text-ink-4" aria-hidden />
      </button>
    </div>
  );
}

/** a small dot after Cloud desktop, only when one exists, so its state is never a click away */
function CloudDot() {
  const { clouds } = useCloud();
  const c = clouds?.[0];
  if (!c) return null;
  const tone = c.status === "running" ? "text-good" : c.status === "provisioning" ? "text-accent" : c.status === "error" ? "text-bad" : "text-ink-4";
  const label = c.status === "running" ? "Running" : c.status === "provisioning" ? "Setting up" : c.status === "error" ? "Needs attention" : "Asleep";
  return <span className={cx("live-dot ms-auto !size-1.5", tone)} role="img" aria-label={label} />;
}

function Nav({ onNavigate }: { onNavigate?: () => void }) {
  const { path } = useLocation();
  return (
    <nav aria-label="Dashboard" className="flex flex-col gap-4">
      {NAV.map((group, i) => (
        <ul key={i} className="flex flex-col gap-px">
          {group.map((item) => {
            const on = active(path, item.to);
            return (
              <li key={item.to}>
                <Link
                  to={item.to}
                  onClick={onNavigate}
                  aria-current={on ? "page" : undefined}
                  className={cx("flex h-8 items-center gap-2.5 rounded-row px-2.5 text-13 transition-colors duration-100 max-lg:h-11 max-lg:text-14", on ? "bg-card-2 text-ink" : "hover-side text-ink-3")}
                >
                  <span className={on ? "text-ink" : "text-ink-4"}>{item.icon}</span>
                  {item.label}
                  {item.to === "/cloud" && <CloudDot />}
                </Link>
              </li>
            );
          })}
        </ul>
      ))}
    </nav>
  );
}

function Brand() {
  return (
    <Link to="/" className="flex h-8 items-center gap-2 rounded-row px-2" aria-label="OpenMausBot, home">
      <Mascot color="blue" size={20} still />
      <span className="text-14 font-semibold tracking-[-0.015em] text-ink">OpenMausBot</span>
    </Link>
  );
}

function Toasts() {
  const { toasts } = useSession();
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-5 z-50 flex flex-col items-center gap-2 px-4">
      {toasts.map((t) => (
        <div key={t.id} className={cx("toast-in max-w-[440px] rounded-full bg-card-2 px-4 py-2.5 text-13", t.tone === "bad" ? "text-bad" : "text-ink")} style={{ boxShadow: "var(--pop-shadow)" }}>{t.text}</div>
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
    <div className="flex h-full flex-col gap-5 px-2.5 pb-2.5 pt-3">
      <div className="flex items-center justify-between">
        <Brand />
        {close && <button onClick={close} aria-label="Close menu" className="hover-ghost grid size-11 place-items-center rounded-full text-ink-3"><X size={18} strokeWidth={1.5} /></button>}
      </div>
      <WorkspaceSwitcher onNavigate={close} />
      <Nav onNavigate={close} />
      <div className="mt-auto"><UserRow onNavigate={close} /></div>
    </div>
  );
  return (
    <div className="min-h-[100dvh] bg-bg">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-full focus:bg-card focus:px-4 focus:py-2">Skip to content</a>
      <aside className="fixed inset-y-0 left-0 z-20 w-[232px] border-e border-line bg-side max-lg:hidden">{side()}</aside>
      <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-line bg-bg/90 px-2 backdrop-blur lg:hidden">
        <button onClick={() => setDrawer(true)} aria-label="Open menu" aria-expanded={drawer} className="hover-ghost grid size-11 place-items-center rounded-full text-ink-2"><Menu size={20} strokeWidth={1.5} /></button>
        <Brand />
        <span className="size-11" aria-hidden />
      </header>
      {drawer && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="fade-in absolute inset-0" style={{ background: "var(--scrim)" }} onClick={() => setDrawer(false)} aria-hidden />
          <div className="drawer-in absolute inset-y-0 left-0 w-[min(300px,86vw)] bg-side">{side(() => setDrawer(false))}</div>
        </div>
      )}
      <main id="main" className="lg:ps-[232px]">
        <div className="mx-auto w-full max-w-[1040px] px-12 pb-24 pt-12 max-lg:px-6 max-lg:pt-7 max-sm:px-4">{children}</div>
      </main>
      <Toasts />
    </div>
  );
}
