import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CornerDownLeft, Search } from "lucide-react";
import { navigate } from "../lib/router";
import { useStore } from "../data/store";
import { download, toCsv } from "../lib/usage";
import { cx, Kbd, STROKE } from "./kit";
import { NAV } from "./nav";

interface Command { id: string; label: string; group: "Pages" | "Settings" | "Actions"; hint?: string; words: string; run: () => void }

const SETTINGS: Array<[label: string, to: string, words: string]> = [
  ["Monthly AI cap", "/billing#limits", "spend limit budget cap ai maximum alert"],
  ["Cloud cap", "/billing#limits", "computer hours limit budget cap cloud"],
  ["Auto top-up", "/billing#balance", "reload recharge refill automatic balance"],
  ["Add funds", "/billing#balance", "top up credit buy balance prepaid"],
  ["Payment methods", "/billing#payment", "card visa link pay"],
  ["Invoices", "/billing#invoices", "receipts bills pdf tax"],
  ["Tax ID and billing address", "/billing#details", "vat address company invoice email"],
  ["Change plan", "/billing#plan", "upgrade downgrade starter pro max subscription cancel"],
  ["Timezone", "/account/profile", "time zone heatmap routines clock"],
  ["Passkeys", "/account/security", "touch id face id sign in login password"],
  ["Active sessions", "/account/security#sessions", "devices sign out logout revoke"],
  ["API tokens", "/account/security#tokens", "key token api automation shortcut"],
  ["Connected apps", "/account/connections", "gmail github calendar integrations connectors"],
  ["Vault", "/account/connections#vault", "passwords logins secrets 1password"],
  ["Your own AI accounts", "/account/connections#ai", "claude chatgpt codex subscription byo"],
  ["Spend alerts", "/account/notifications", "email push notify warning"],
  ["Export your data", "/account/privacy", "download backup takeout"],
  ["Delete account", "/account/privacy#delete", "close remove erase"],
  ["Update window", "/cloud?tab=power", "upgrade version maintenance reboot schedule"],
  ["Snapshots and backups", "/cloud?tab=backups", "restore backup snapshot"],
  ["Idle sleep", "/cloud/computers", "sleep wake asleep idle timeout"],
];

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data, toast } = useStore();
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();

  const commands = useMemo<Command[]>(() => {
    const go = (to: string) => () => navigate(to);
    return [
      ...NAV.flatMap((item) => (item.children ?? [item]).map((n) => ({ id: n.to, label: n.label, group: "Pages" as const, words: `${n.label} ${item.label} ${n.words ?? ""}`, run: go(n.to) }))),
      ...data.bots.map((b) => ({ id: `bot-${b.id}`, label: b.name, group: "Pages" as const, hint: `Bot, ${b.role || b.engine}`, words: `${b.name} ${b.role} bot`, run: go(`/bots/${b.id}`) })),
      ...SETTINGS.map(([label, to, words]) => ({ id: `set-${label}`, label, group: "Settings" as const, words: `${label} ${words}`, run: go(to) })),
      { id: "act-csv", label: "Export this month's usage as CSV", group: "Actions", words: "download export csv spreadsheet usage", run: () => { download("usage.csv", toCsv(data.turns.filter((t) => t.at >= data.billing.periodStart), data.bots), "text/csv"); toast("Usage exported as CSV"); } },
      ...data.computers.filter((c) => c.state === "asleep").map((c) => ({ id: `wake-${c.id}`, label: `Wake ${c.name}`, group: "Actions" as const, words: `wake start computer ${c.name}`, run: go("/cloud/computers") })),
      { id: "act-app", label: "Open the app", group: "Actions", words: "desktop launch chat", run: () => { window.location.href = "openmausbot://open"; } },
    ];
  }, [data, toast]);

  const results = useMemo(() => {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return commands.filter((c) => c.group !== "Settings").slice(0, 14);
    return commands.filter((c) => terms.every((t) => c.words.toLowerCase().includes(t))).slice(0, 20);
  }, [q, commands]);

  useEffect(() => { setActive(0); }, [q]);
  useEffect(() => {
    if (!open) return;
    setQ("");
    const before = document.activeElement as HTMLElement | null;
    requestAnimationFrame(() => input.current?.focus());
    return () => before?.focus?.();
  }, [open]);
  useEffect(() => { document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: "nearest" }); }, [active, listId]);

  if (!open) return null;
  const run = (c: Command | undefined) => { if (!c) return; onClose(); c.run(); };
  let lastGroup = "";
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-start justify-center px-3 pt-[12vh]">
      <div className="absolute inset-0 bg-[#1c1c18]/20" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label="Search and commands" className="relative w-full max-w-[560px] overflow-hidden rounded-card border border-line bg-surface shadow-pop"
        onKeyDown={(e) => {
          if (e.key === "Escape") { e.preventDefault(); onClose(); }
          else if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(results.length - 1, a + 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
          else if (e.key === "Enter") { e.preventDefault(); run(results[active]); }
          else if (e.key === "Tab") e.preventDefault();
        }}>
        <div className="flex h-12 items-center gap-2.5 border-b border-row px-4">
          <Search size={16} strokeWidth={STROKE} className="text-ink-3" aria-hidden />
          <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search pages, settings and actions" aria-label="Search pages, settings and actions"
            role="combobox" aria-expanded="true" aria-controls={listId} aria-activedescendant={results.length ? `${listId}-${active}` : undefined}
            className="h-full min-w-0 flex-1 bg-transparent text-14 outline-none placeholder:text-ink-4 focus-visible:outline-none" />
          <Kbd>esc</Kbd>
        </div>
        <div id={listId} role="listbox" aria-label="Results" className="max-h-[min(420px,60vh)] overflow-y-auto p-1.5">
          {results.length === 0 && <p className="px-3 py-8 text-center text-13 text-ink-3">Nothing matches "{q}". Try "cap", "invoice" or a bot's name.</p>}
          {results.map((c, i) => {
            const head = c.group !== lastGroup ? (lastGroup = c.group) : null;
            return (
              <div key={c.id}>
                {head && <p className="px-2.5 pb-1 pt-2.5 text-12 font-medium text-ink-4" aria-hidden>{head}</p>}
                <div id={`${listId}-${i}`} role="option" aria-selected={i === active} onMouseMove={() => setActive(i)} onClick={() => run(c)}
                  className={cx("flex h-9 cursor-pointer items-center gap-2 rounded-[8px] px-2.5 text-13 pointer-coarse:h-11", i === active ? "bg-hover text-ink" : "text-ink-2")}>
                  <span className="flex-1 truncate">{c.label}</span>
                  {c.hint && <span className="text-12 text-ink-4">{c.hint}</span>}
                  {i === active && <CornerDownLeft size={13} strokeWidth={STROKE} className="text-ink-4" aria-hidden />}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>,
    document.body,
  );
}
