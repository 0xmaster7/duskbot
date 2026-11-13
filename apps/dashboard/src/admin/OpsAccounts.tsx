import { useState, type ReactNode } from "react";
import { cx } from "../ui/kit";
import { Link } from "../lib/router";
import { useAdmin } from "./api";
import { Avatar, percent, personName, usd } from "./kit";
import { n } from "./ui";
import { DataSwitch } from "./DataSwitch";
import { Bar, Empty, Panel, size } from "./Ops";
import type { OpsAccountFlag, OpsAccountRow, OpsAccountsAnswer, OpsFairStage, OpsLevel } from "./ops-types";

const personLink = (accountId: string) => `/admin/people/visitors?person=${encodeURIComponent(accountId)}`;
const STAGE: Record<OpsFairStage, { word: string; level: OpsLevel }> = { full: { word: "full speed", level: "ok" }, slowing: { word: "slowing", level: "watch" }, chat: { word: "chat only", level: "bad" } };
const FLAG: Record<OpsAccountFlag["kind"], { word: string; cls: string; rank: number }> = {
  abuse: { word: "possible abuse", cls: "bg-wash-pink text-ink", rank: 0 },
  throttled: { word: "throttled", cls: "bg-wash-lemon text-ink", rank: 1 },
  check: { word: "needs checking", cls: "bg-wash-sky text-ink", rank: 2 },
};

type SortKey = "relay" | "share" | "awake" | "cost" | "emails" | "codes" | "flags";
const COLUMNS: Array<{ key: SortKey; label: string }> = [
  { key: "relay", label: "relay" }, { key: "share", label: "share" }, { key: "awake", label: "awake" }, { key: "cost", label: "cost" },
  { key: "emails", label: "emails" }, { key: "codes", label: "codes" }, { key: "flags", label: "flags" },
];
const valueOf = (row: OpsAccountRow, key: SortKey) => {
  switch (key) {
    case "relay": return row.relay?.monthBytes ?? -1;
    case "share": return row.relay?.share ?? -1;
    case "awake": return row.cloud?.awakeHours ?? -1;
    case "cost": return row.cloud?.costCents ?? -1;
    case "emails": return row.emails ?? -1;
    case "codes": return row.codes ?? -1;
    case "flags": return row.flags.reduce((sum, flag) => sum + (3 - FLAG[flag.kind].rank) * 10, 0);
  }
};
const COLS = "grid grid-cols-[minmax(180px,1.6fr)_minmax(140px,1fr)_60px_64px_72px_60px_56px_minmax(128px,1.1fr)] items-center gap-3";
const PAGE = 20;

function Flags({ flags }: { flags: OpsAccountFlag[] }) {
  if (!flags.length) return <span className="block text-end text-12 text-ink-4">-</span>;
  const kinds = [...new Set(flags.map((flag) => flag.kind))].sort((a, b) => FLAG[a].rank - FLAG[b].rank);
  return (
    <span className="flex flex-wrap justify-end gap-1" title={flags.map((flag) => flag.why).join("\n")}>
      {kinds.map((kind) => <span key={kind} className={cx("inline-flex h-[22px] items-center whitespace-nowrap rounded-full px-2 text-12", FLAG[kind].cls)}>{FLAG[kind].word}</span>)}
      <span className="sr-only">: {flags.map((flag) => flag.why).join("; ")}</span>
    </span>
  );
}

function RelayCell({ relay, floorAt, fullSpeed }: { relay: OpsAccountRow["relay"]; floorAt: number; fullSpeed: number }) {
  if (!relay) return <span className="text-12 text-ink-4">-</span>;
  const stage = STAGE[relay.stage];
  return (
    <span className="block">
      <span className="flex items-baseline justify-end gap-1.5"><span className={cx("text-12", stage.level === "ok" ? "text-ink-3" : "text-ink-2")}>{stage.word}</span><span className="font-mono text-ink num">{size(relay.monthBytes)}</span></span>
      <span className="mt-1 block"><Bar share={relay.monthBytes / floorAt} level={stage.level} tick={fullSpeed / floorAt} /></span>
    </span>
  );
}

const num = (value: number | null, render: (v: number) => ReactNode = n) => value === null ? <span className="text-ink-4">-</span> : render(value);

/** who uses the most this month: relay traffic on the fair use curve, dusk cloud time and cost, emails sent to them */
export function TopAccounts() {
  const { data, error } = useAdmin<OpsAccountsAnswer>("/ops/accounts", 60_000);
  const me = useAdmin<{ live?: string | null }>("/me");
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "relay", desc: true });
  const [shown, setShown] = useState(PAGE);
  const rows = data ? [...data.rows].sort((a, b) => (valueOf(b, sort.key) - valueOf(a, sort.key)) * (sort.desc ? 1 : -1)) : [];
  const flagged = data ? data.rows.filter((row) => row.flags.length).length : 0;
  const notYet = data ? [!data.reported.relay && "relay", !data.reported.cloud && "dusk cloud", !data.reported.mail && "emails"].filter(Boolean) : [];
  const toggle = (key: SortKey) => { setSort((s) => s.key === key ? { key, desc: !s.desc } : { key, desc: true }); setShown(PAGE); };
  const fullSpeed = data?.fairUse.fullSpeedBytes ?? 20e9, floorAt = data?.fairUse.floorAtBytes ?? 80e9;
  return (
    <Panel id="ops-accounts" title={`top accounts this month${data && data.data !== "own" ? `, ${data.data}` : ""}`}
      meta={<span className="inline-flex flex-wrap items-center gap-3">
        {data && <span>{n(data.rows.length)} {data.rows.length === 1 ? "account" : "accounts"} · {n(flagged)} flagged · fair use {size(fullSpeed)} to {size(floorAt)}</span>}
        {me.data?.live && <DataSwitch live={me.data.live} />}
      </span>}>
      {error && !data && <Empty>accounts can't be read right now: {error.message}</Empty>}
      {!data && !error && <div className="h-[360px] animate-pulse rounded-[12px] bg-card" />}
      {data && (
        <div role="region" className="scroll-x" tabIndex={0} aria-label="top accounts, scrolls sideways on a small screen">
          <div role="table" aria-label="top accounts this month" className="min-w-[900px]">
            <div role="row" className={cx(COLS, "px-2.5 pb-1 pt-1 t-meta")}>
              <span role="columnheader">account</span>
              {COLUMNS.map((col) => {
                const active = sort.key === col.key;
                return (
                  <span key={col.key} role="columnheader" aria-sort={active ? (sort.desc ? "descending" : "ascending") : "none"} className="text-end">
                    <button type="button" onClick={() => toggle(col.key)} className={cx("hover-ghost -mx-1.5 inline-flex h-7 items-center gap-1 rounded-full px-1.5", active ? "text-ink-2" : "text-ink-3")}>
                      {col.label}<span aria-hidden className={cx("text-[10px]", !active && "opacity-0")}>{sort.desc ? "▼" : "▲"}</span>
                    </button>
                  </span>
                );
              })}
            </div>
            {rows.length ? rows.slice(0, shown).map((row) => {
              const name = row.accountId ? personName(row.accountId, row.email) : `account ${(row.ref ?? "").slice(0, 8)}`;
              const cells = (
                <>
                  <span role="rowheader" className="flex min-w-0 items-center gap-2.5">
                    {row.accountId && <Avatar seed={row.accountId} size={20} customer />}
                    {row.accountId
                      ? <Link to={personLink(row.accountId)} className="truncate text-13 text-ink after:absolute after:inset-0 after:rounded-[12px]">{name}</Link>
                      : <span className="truncate text-13 text-ink">{name}</span>}
                  </span>
                  <span role="cell" className="text-13"><RelayCell relay={row.relay} floorAt={floorAt} fullSpeed={fullSpeed} /></span>
                  <span role="cell" className="text-end font-mono text-13 text-ink-2 num">{row.relay ? percent(row.relay.share) : <span className="text-ink-4">-</span>}</span>
                  <span role="cell" className="text-end font-mono text-13 text-ink-2 num">{row.cloud ? `${n(Math.round(row.cloud.awakeHours))} h` : <span className="text-ink-4">-</span>}</span>
                  <span role="cell" className={cx("text-end font-mono text-13 num", row.cloud?.costCents ? "text-money" : "text-ink-4")}>{row.cloud ? usd(row.cloud.costCents) : "-"}</span>
                  <span role="cell" className="text-end font-mono text-13 text-ink-2 num">{num(row.emails)}</span>
                  <span role="cell" className="text-end font-mono text-13 text-ink-2 num">{num(row.codes)}</span>
                  <span role="cell" className="relative z-[1]"><Flags flags={row.flags} /></span>
                </>
              );
              return <div key={row.accountId ?? row.ref ?? name} role="row" className={cx(COLS, "relative rounded-[12px] px-2.5 py-2", row.accountId && "hover-row")}>{cells}</div>;
            }) : <Empty>nobody has used the relay, a dusk cloud or an email this month.</Empty>}
          </div>
        </div>
      )}
      {data && rows.length > shown && <button type="button" onClick={() => setShown((v) => v + PAGE)} className="text-link mx-auto block h-9 px-3 text-12">show more ({n(rows.length - shown)} left)</button>}
      {notYet.length > 0 && <p className="px-2.5 pb-2 pt-1 text-12 text-ink-3">{notYet.join(", ")}: not reported yet.</p>}
    </Panel>
  );
}
