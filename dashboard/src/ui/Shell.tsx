import { useEffect, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { BookOpen, ChevronsUpDown, ExternalLink, Menu as MenuIcon, Search, Signal, X } from "lucide-react";
import { useStore } from "../data/store";
import { Link, useLocation } from "../lib/router";
import { usd } from "../lib/format";
import { turnPaid } from "../lib/usage";
import { CommandPalette } from "./CommandPalette";
import { ButtonLink, cx, IconButton, Kbd, Pill, STROKE, Ticks } from "./kit";
import { Mascot, useReducedMotion } from "./Mascot";
import { Menu, Toasts } from "./overlays";
import { NAV, type NavItem } from "./nav";

const isActive = (path: string, to: string) => (to === "/" ? path === "/" : path === to || (to !== "/cloud" && path.startsWith(`${to}/`)) || (to === "/cloud" && path === "/cloud"));

function NavRow({ item, path, nested, onGo }: { item: NavItem; path: string; nested?: boolean; onGo?: () => void }) {
  const active = isActive(path, item.to) || (item.to === "/bots" && path.startsWith("/bots/"));
  const Icon = item.icon;
  return (
    <Link to={item.to} onClick={onGo} aria-current={active ? "page" : undefined}
      className={cx("flex h-7 items-center gap-2 rounded-row px-2 text-13 font-medium transition-colors duration-150 pointer-coarse:h-11",
        nested && "ps-[30px]", active ? "bg-[#ebebe8] text-ink" : "text-ink-2 hover:bg-[#efefec] hover:text-ink")}>
      {Icon && <Icon size={14} strokeWidth={STROKE} className={active ? "text-ink" : "text-ink-3"} aria-hidden />}
      <span className="truncate">{item.label}</span>
    </Link>
  );
}

function Sidebar({ path, onSearch, onGo }: { path: string; onSearch: () => void; onGo?: () => void }) {
  const { data, toast } = useStore();
  const period = data.billing.periodStart;
  const spent = data.turns.filter((t) => t.at >= period).reduce((s, t) => s + turnPaid(t), 0);
  const cap = data.billing.caps.ai.limitUsd;
  const sample = Object.values(data.origin).some((o) => o === "sample");
  return (
    <div className="flex h-full flex-col gap-3 px-3 py-3">
      <Menu label="Switch Cloud" align="start"
        trigger={(p) => (
          <button type="button" {...p} className="flex h-10 w-full items-center gap-2 rounded-row px-1.5 text-start hover:bg-[#efefec] pointer-coarse:h-12">
            <span className="flex size-7 items-center justify-center rounded-[8px] bg-surface shadow-card"><Mascot color="blue" body="cloud" size={20} still /></span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-13 font-medium">{data.account.name.split(" ")[0]}'s Cloud</span>
              <span className="block text-12 text-ink-3">{data.billing.plan.label} plan</span>
            </span>
            <ChevronsUpDown size={14} strokeWidth={STROKE} className="text-ink-3" aria-hidden />
          </button>
        )}
        items={[{ label: `${data.account.name.split(" ")[0]}'s Cloud (personal)`, onSelect: () => {} }, { label: "Start a team Cloud", onSelect: () => toast("Team Clouds open from the app: Settings, Team") }]} />

      <button type="button" onClick={onSearch} className="flex h-8 items-center gap-2 rounded-row border border-line bg-surface px-2.5 text-13 text-ink-3 hover:text-ink pointer-coarse:h-11">
        <Search size={14} strokeWidth={STROKE} aria-hidden />
        <span className="flex-1 text-start">Search</span>
        <Kbd>⌘K</Kbd>
      </button>

      <nav aria-label="Dashboard" className="flex flex-col gap-0.5">
        {NAV.map((item) => item.children ? (
          <div key={item.label} className="flex flex-col gap-0.5">
            <p className="flex h-7 items-center gap-2 px-2 text-13 font-medium text-ink-2">
              {item.icon && <item.icon size={14} strokeWidth={STROKE} className="text-ink-3" aria-hidden />}{item.label}
            </p>
            {item.children.map((c) => <NavRow key={c.to} item={{ ...c, icon: undefined }} path={path} nested onGo={onGo} />)}
          </div>
        ) : <NavRow key={item.to} item={item} path={path} onGo={onGo} />)}
      </nav>

      <div className="mt-auto flex flex-col gap-3">
        <Link to="/billing#limits" onClick={onGo} className="block rounded-card border border-line bg-surface p-3 shadow-card transition-colors hover:border-[#dcdcd9]">
          <span className="flex items-center justify-between text-12 text-ink-3"><span>AI spend this month</span><span className="num">{Math.round((spent / cap) * 100)}%</span></span>
          <span className="num mt-1 block text-14 font-medium text-ink">{usd(spent)} <span className="font-normal text-ink-3">of {usd(cap)}</span></span>
          <span className="mt-2 block"><Ticks value={spent} max={cap} size="lg" label={`AI spend ${usd(spent)} of ${usd(cap)} cap`} /></span>
        </Link>
        <ButtonLink to="openmausbot://open" external variant="primary" icon={ExternalLink} className="w-full">Open the app</ButtonLink>
        <div className="flex items-center gap-3 px-1 text-12 text-ink-3">
          <a href="https://status.openmausbot.com" className="inline-flex items-center gap-1 hover:text-ink"><Signal size={12} strokeWidth={STROKE} aria-hidden />Status</a>
          <a href="https://docs.openmausbot.com" className="inline-flex items-center gap-1 hover:text-ink"><BookOpen size={12} strokeWidth={STROKE} aria-hidden />Docs</a>
          {sample && <Pill tone="outline" className="ms-auto" >Sample data</Pill>}
        </div>
      </div>
    </div>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const { path } = useLocation();
  const [palette, setPalette] = useState(false);
  const [sheet, setSheet] = useState(false);
  const reduced = useReducedMotion();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPalette((p) => !p); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => { setSheet(false); }, [path]);
  useEffect(() => {
    if (!sheet) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setSheet(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sheet]);

  return (
    <div className="min-h-[100dvh]">
      <a href="#main" className="sr-only z-[80] rounded-full bg-black px-3 py-2 text-13 text-[#fafafa] focus:not-sr-only focus:fixed focus:start-3 focus:top-3">Skip to content</a>
      <aside className="fixed inset-y-0 start-0 hidden w-[240px] lg:block">
        <Sidebar path={path} onSearch={() => setPalette(true)} />
      </aside>

      <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-line bg-canvas/90 px-2 backdrop-blur lg:hidden">
        <IconButton label="Open menu" icon={MenuIcon} onClick={() => setSheet(true)} aria-expanded={sheet} />
        <Link to="/" className="flex items-center gap-2 text-14 font-medium"><Mascot color="blue" body="cloud" size={22} still />OpenMausBot</Link>
        <IconButton label="Search" icon={Search} className="ms-auto" onClick={() => setPalette(true)} />
      </header>

      <AnimatePresence>
        {sheet && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <motion.div className="absolute inset-0 bg-[#1c1c18]/25" onClick={() => setSheet(false)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} />
            <motion.div role="dialog" aria-modal="true" aria-label="Menu" className="absolute inset-y-0 start-0 w-[min(300px,86vw)] overflow-y-auto bg-canvas shadow-pop"
              initial={reduced ? { opacity: 0 } : { transform: "translateX(-100%)" }} animate={reduced ? { opacity: 1 } : { transform: "translateX(0%)" }} exit={reduced ? { opacity: 0 } : { transform: "translateX(-100%)" }}
              transition={{ duration: reduced ? 0.15 : 0.38, ease: [0.32, 0.72, 0, 1] }}>
              <div className="flex justify-end px-2 pt-2"><IconButton label="Close menu" icon={X} onClick={() => setSheet(false)} /></div>
              <Sidebar path={path} onSearch={() => { setSheet(false); setPalette(true); }} onGo={() => setSheet(false)} />
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <main id="main" className="lg:ps-[240px]">
        <div key={path} className="mx-auto w-full max-w-[1160px] animate-rise px-4 pb-24 pt-6 sm:px-6 lg:px-10 lg:pt-10">{children}</div>
      </main>

      <CommandPalette open={palette} onClose={() => setPalette(false)} />
      <Toasts />
    </div>
  );
}
