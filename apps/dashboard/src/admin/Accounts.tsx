import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Search } from "@/icons";
import { cx } from "../ui/kit";
import { ago } from "../lib/format";
import { navigate, useLocation } from "../lib/router";
import { useNow } from "../lib/now";
import { adminCall, useAdmin } from "./api";
import { openCard, PersonLink } from "./sheet";
import { Highlight } from "./motion";
import { usd } from "./kit";
import { Failed, n } from "./ui";
import { identity, PersonFace } from "./identity";
import { PEOPLE_FIRST } from "./Home";
import { LIVE_PLAN, type AccountRowV2, type PeopleV2 } from "./v2";

export const accountReads = () => [PEOPLE_FIRST];

type Filter = "all" | "paying" | "app" | "new";
type Sort = "joined" | "seen" | "paid";
const FILTERS: Array<[Filter, string]> = [["all", "everyone"], ["paying", "paying"], ["app", "with the app"], ["new", "not set up yet"]];
const SORTS: Array<[Sort, string]> = [["seen", "last seen"], ["joined", "newest"], ["paid", "paid most"]];
const ROW = 60;
const PROVIDER: Record<string, string> = { google: "google", apple: "apple", github: "github", microsoft: "microsoft" };

/** every account: the first page is shared with home, the rest follow by cursor */
function useAllPeople() {
  const first = useAdmin<PeopleV2>(PEOPLE_FIRST);
  const [rest, setRest] = useState<AccountRowV2[]>([]);
  const start = first.data?.next ?? null;
  useEffect(() => {
    setRest([]);
    if (!start) return;
    const controller = new AbortController();
    void (async () => {
      let cursor: string | null = start;
      const out: AccountRowV2[] = [];
      while (cursor && !controller.signal.aborted && out.length < 20_000) {
        const page: PeopleV2 = await adminCall<PeopleV2>(`${PEOPLE_FIRST}&cursor=${encodeURIComponent(cursor)}`, { signal: controller.signal });
        out.push(...page.people);
        cursor = page.next;
        setRest([...out]);
      }
    })().catch(() => { /* the first page still shows */ });
    return () => controller.abort();
  }, [start]);
  return { people: first.data ? [...first.data.people, ...rest] : null, total: first.data?.total ?? 0, money: first.data?.money ?? "live", error: first.error, reload: first.reload };
}

/** the rows a window-scrolled list should draw: what is on screen plus a screen's worth either side */
function useWindowRows(count: number, list: React.RefObject<HTMLElement | null>) {
  const [range, setRange] = useState<[number, number]>([0, 60]);
  useLayoutEffect(() => {
    const update = () => {
      const el = list.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top, h = window.innerHeight;
      const start = Math.max(0, Math.floor(-top / ROW) - 20), end = Math.min(count, Math.ceil((h - top) / ROW) + 20);
      setRange((prev) => prev[0] === start && prev[1] === end ? prev : [start, Math.max(start, end)]);
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => { window.removeEventListener("scroll", update); window.removeEventListener("resize", update); };
  }, [count, list]);
  return range;
}

export function AccountsPage() {
  const { query } = useLocation();
  const { people, total, money, error, reload } = useAllPeople();
  const now = useNow(60_000);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("seen");
  const [active, setActive] = useState(-1);
  const box = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  useEffect(() => {
    if (query.get("find") !== "1") return;
    box.current?.focus();
    const next = new URLSearchParams(query); next.delete("find");
    navigate(`/admin/people${next.size ? `?${next}` : ""}`, { replace: true });
  }, [query]);
  const rows = useMemo(() => {
    if (!people) return [];
    const needle = q.trim().toLowerCase();
    const out = people.filter((r) => {
      if (filter === "paying" && !(r.planStatus && LIVE_PLAN.has(r.planStatus))) return false;
      if (filter === "app" && !(r.installs || r.devices)) return false;
      if (filter === "new" && r.onboarded) return false;
      const p = r.person;
      return !needle || p.name.toLowerCase().includes(needle) || (p.email ?? "").toLowerCase().includes(needle) || p.id.toLowerCase() === needle || p.providers.some((x) => x === needle);
    });
    const by = { joined: (r: AccountRowV2) => r.createdAt, seen: (r: AccountRowV2) => r.lastSeenAt ?? 0, paid: (r: AccountRowV2) => r.paidCents }[sort];
    return out.sort((a, b) => by(b) - by(a));
  }, [people, q, filter, sort]);
  useEffect(() => setActive(-1), [q, filter, sort]);
  const [vStart, vEnd] = useWindowRows(rows.length, list);
  // short lists draw every row; only a long one is windowed
  const [start, end] = rows.length > 150 ? [vStart, vEnd] : [0, rows.length];
  // j and k walk the list, enter opens the person; instant, no motion, since it repeats
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const typingIn = (e.target as HTMLElement | null)?.closest?.("input, textarea, select, [role=dialog]");
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (typingIn && !(e.target === box.current && (e.key === "ArrowDown" || e.key === "Enter"))) return;
      if (e.key === "j" || e.key === "ArrowDown") { e.preventDefault(); if (e.target === box.current) box.current?.blur(); setActive((i) => Math.min(rows.length - 1, i + 1)); }
      else if (e.key === "k" || e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
      else if (e.key === "Enter" && rows.length) { const row = rows[Math.max(0, active)]; if (row) { e.preventDefault(); openCard("person", row.person.id); } }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [rows, active]);
  useEffect(() => {
    if (active < 0 || !list.current) return;
    const top = list.current.getBoundingClientRect().top + window.scrollY + active * ROW;
    if (top < window.scrollY + 120) window.scrollTo({ top: top - 120 });
    else if (top + ROW > window.scrollY + window.innerHeight - 24) window.scrollTo({ top: top + ROW - window.innerHeight + 24 });
  }, [active]);

  const grid = "grid grid-cols-[minmax(0,2.4fr)_minmax(0,0.9fr)_minmax(0,0.9fr)_minmax(0,0.8fr)_88px_88px] items-center gap-4 max-lg:grid-cols-[minmax(0,1fr)_auto]";
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[240px] flex-1 max-w-[420px] max-sm:max-w-none">
          <label htmlFor="people-search" className="sr-only">search people</label>
          <Search size={16} strokeWidth={1.75} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-4" aria-hidden />
          <input ref={box} id="people-search" data-admin-search type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="name, email or account id" autoComplete="off" spellCheck={false} className="field !h-10 !rounded-full !ps-10 !text-14" />
        </div>
        <div role="radiogroup" aria-label="show" className="scroll-x relative inline-flex max-w-full gap-0.5 rounded-full bg-card p-1">
          <Highlight target={filter} className="bg-pop" />
          {FILTERS.map(([v, label]) => <button key={v} type="button" role="radio" aria-checked={filter === v} data-hl={v} onClick={() => setFilter(v)} className={cx("relative z-[1] h-8 shrink-0 whitespace-nowrap rounded-full px-3 text-13", filter === v ? "font-medium text-ink" : "text-ink-3 hover-link")}>{label}</button>)}
        </div>
        <label className="ms-auto flex items-center gap-2 text-13 text-ink-3 max-sm:ms-0">
          sort
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="field !h-9 !w-auto !rounded-full !py-0 !ps-3 !pe-8 !text-13">
            {SORTS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
          </select>
        </label>
      </div>
      <p className="mb-2 flex h-5 items-center px-3 text-12 text-ink-3" aria-live="polite">
        {people ? `${q || filter !== "all" ? `${n(rows.length)} of ` : ""}${n(total)} accounts${money === "test" ? ", test money" : ""}${people.length < total ? `, loading ${n(total - people.length)} more` : ""}` : "loading accounts"}
        <span className="ms-auto max-sm:hidden">j k to move, enter to open</span>
      </p>
      {error && !people ? <Failed error={error} retry={reload} /> : (
        <div className="rounded-[24px] bg-card p-1.5">
          <div className={cx(grid, "h-9 px-3 t-meta max-lg:hidden")} aria-hidden>
            <span>person</span><span>signed in with</span><span>plan</span><span className="text-end">paid</span><span className="text-end">last seen</span><span className="text-end">joined</span>
          </div>
          {!people ? (
            <div data-skeleton aria-busy="true" aria-label="loading accounts" className="flex flex-col gap-1 rounded-[18px] bg-pop p-1.5">
              {Array.from({ length: 8 }, (_, i) => <span key={i} className="block animate-pulse rounded-[14px] bg-card" style={{ height: ROW - 4 }} />)}
            </div>
          ) : rows.length ? (
            <ul ref={list} aria-label="accounts" className="relative rounded-[18px] bg-pop p-1.5" style={{ height: rows.length * ROW + 12 }}>
              {rows.slice(start, end).map((r, i) => {
                const index = start + i, p = r.person, who = identity({ id: p.id, identity: p });
                const methods = p.providers.filter((x) => x !== "email");
                const plan = r.plan && r.planStatus && r.planStatus !== "ended" ? { name: r.plan, status: r.planStatus } : null;
                const apps = r.installs || r.devices;
                return (
                  <li key={p.id} className="absolute inset-x-1.5" style={{ top: 6 + index * ROW, height: ROW }}>
                    <PersonLink id={p.id} className={cx(grid, "hover-row h-full rounded-[14px] px-3", index === active && "bg-card-2")}>
                      <span className="flex min-w-0 items-center gap-3">
                        <PersonFace id={p.id} size={32} avatarUrl={p.avatarUrl} avatar={p.avatar ?? undefined} />
                        <span className="min-w-0">
                          <span className="block truncate text-14 font-medium text-ink">{who.name}</span>
                          <span className="block truncate text-12 text-ink-3">{who.sub ?? (apps ? `${n(apps)} app${apps === 1 ? "" : "s"}` : r.onboarded ? "set up, no app yet" : "not set up yet")}</span>
                        </span>
                      </span>
                      <span className="truncate text-13 text-ink-2 max-lg:hidden">{methods.length ? methods.map((m) => PROVIDER[m] ?? m).join(", ") : "email code"}</span>
                      <span className="truncate text-13 max-lg:hidden">{plan ? <span className="inline-flex items-center gap-1.5 text-ink"><span className={cx("size-[7px] rounded-[2px]", plan.status === "active" ? "bg-good" : plan.status === "payment_problem" ? "bg-bad" : "bg-warn")} aria-hidden />{plan.name}{plan.status !== "active" && <span className="text-ink-3">{plan.status.replace(/_/g, " ")}</span>}</span> : <span className="text-ink-4">free</span>}</span>
                      <span className="text-end font-mono text-13 num max-lg:order-last">
                        {r.paidCents ? <span className={cx("font-medium", money === "test" ? "text-ink-2" : "text-money")}>{usd(r.paidCents)}</span> : <span className="text-ink-4 max-lg:hidden">-</span>}
                        <span className="hidden font-sans text-12 text-ink-4 max-lg:block">{ago(r.lastSeenAt, now)}</span>
                      </span>
                      <span className="text-end text-12 text-ink-3 max-lg:hidden">{ago(r.lastSeenAt, now)}</span>
                      <span className="text-end text-12 text-ink-4 max-lg:hidden">{ago(r.createdAt, now)}</span>
                    </PersonLink>
                  </li>
                );
              })}
            </ul>
          ) : <p className="rounded-[18px] bg-pop px-4 py-10 text-center text-14 text-ink-3">{q ? `no account matches "${q}".` : "no accounts in this view yet."}</p>}
        </div>
      )}
    </>
  );
}
