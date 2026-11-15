import { useCallback, useId, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "@/icons";
import { cx } from "../ui/kit";
import { AnimatePresence, m } from "../ui/motion";
import { ago } from "../lib/format";
import { useLocation } from "../lib/router";
import { useNow } from "../lib/now";
import { invalidateAdmin, useAdmin, type UserDetail } from "./api";
import { closeCard, SidePanel } from "./sheet";
import { CHANNEL, usd, where } from "./kit";
import { Failed, n, stamp } from "./ui";
import { identity, PersonFace } from "./identity";
import { Journey, type Profile } from "./People";
import { CopyEmail, ModeChip, PlanLength } from "./CustomerSheet";
import { PlanEditor, endLabel } from "./PlanEditor";
import { CloudTable } from "./Clouds";
import { Platform } from "./person";
import { Highlight } from "./motion";

const LIVE = ["active", "payment_problem", "cancelled"];
const day = (t: number) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", ...(new Date(t).getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}) }).toLowerCase();
const PROVIDER: Record<string, string> = { google: "google", apple: "apple", github: "github", microsoft: "microsoft", email: "email code" };

/** the one card for anyone: an account (money, installs, clouds, journey) or an anonymous visitor (their journey) */
export function PersonSheetHost() {
  const { query } = useLocation();
  const id = query.get("person");
  return createPortal(<AnimatePresence>{id && <Sheet key={id} id={id} />}</AnimatePresence>, document.body);
}

function Sheet({ id }: { id: string }) {
  const titleId = useId();
  const pending = useRef<(() => void) | null>(null);
  const close = useCallback(() => closeCard("person"), []);
  const account = id.startsWith("acct_");
  return (
    <SidePanel label={account ? "account" : "visitor"} titleId={titleId} onClose={close} pending={pending} wide>
      {account ? <AccountCard id={id} titleId={titleId} pending={pending} /> : <VisitorCard id={id} titleId={titleId} pending={pending} />}
    </SidePanel>
  );
}

function Cell({ label, value, note, money }: { label: string; value: ReactNode; note?: ReactNode; money?: boolean }) {
  return (
    <div className="min-w-0 px-3.5 py-3">
      <div className="truncate text-12 text-ink-3">{label}</div>
      <div className={cx("mt-0.5 truncate text-[17px] font-medium leading-6", money ? "font-mono text-money num" : "text-ink")}>{value}</div>
      <div className="h-[18px] truncate text-12 leading-[18px] text-ink-4">{note}</div>
    </div>
  );
}

function SheetSkeleton({ titleId }: { titleId: string }) {
  return (
    <div data-skeleton aria-busy="true" className="mt-3">
      <h2 id={titleId} className="sr-only">loading</h2>
      <div className="flex items-center gap-4"><span className="size-14 animate-pulse rounded-full bg-card" /><span className="flex flex-col gap-2"><span className="h-5 w-48 animate-pulse rounded-[8px] bg-card" /><span className="h-4 w-32 animate-pulse rounded-[8px] bg-card" /></span></div>
      <span className="mt-6 block h-[78px] animate-pulse rounded-[20px] bg-card" />
      <span className="mt-6 block h-64 animate-pulse rounded-[20px] bg-card" />
    </div>
  );
}

type Tab = "money" | "installs" | "journey";
function Tabs({ tab, setTab, items }: { tab: Tab; setTab(t: Tab): void; items: Array<[Tab, string, number | null]> }) {
  return (
    <div role="tablist" aria-label="about them" className="relative mt-6 inline-flex gap-0.5 self-start rounded-full bg-card p-1">
      <Highlight target={tab} className="bg-pop" />
      {items.map(([id, label, count]) => (
        <button key={id} type="button" role="tab" aria-selected={tab === id} data-hl={id} onClick={() => setTab(id)}
          className={cx("relative z-[1] inline-flex h-8 items-center gap-1.5 rounded-full px-3.5 text-13", tab === id ? "font-medium text-ink" : "text-ink-3 hover-link")}>
          {label}{count !== null && <span className="font-mono text-[11px] text-ink-4 num">{count}</span>}
        </button>
      ))}
    </div>
  );
}

function Origin({ profile }: { profile: Profile | null }) {
  const first = profile?.firstSource, place = profile?.where;
  if (!profile) return null;
  return (
    <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-13 text-ink-3">
      <span>{first ? <>came from <span className="text-ink-2">{first.source}</span>{first.channel !== "direct" && first.channel !== first.source ? ` (${CHANNEL[first.channel] ?? first.channel})` : ""}</> : "no site visit recorded"}</span>
      {place?.country && <span>{where(place.country, place.city)}</span>}
      <Platform kind="os" value={place?.os} />
      <Platform kind="browser" value={place?.browser} />
    </p>
  );
}

function AccountCard({ id, titleId, pending }: { id: string; titleId: string; pending: MutableRefObject<(() => void) | null> }) {
  const detail = useAdmin<UserDetail>(`/users/${encodeURIComponent(id)}`);
  const profile = useAdmin<Profile>(`/journeys/${encodeURIComponent(id)}`);
  const now = useNow(60_000);
  const d = detail.data;
  const [picked, setTab] = useState<Tab | null>(null);
  const [more, setMore] = useState(false);
  const onChange = useCallback((next: UserDetail) => { detail.setData(next); invalidateAdmin("/users"); invalidateAdmin("/revenue"); }, [detail.setData]);
  if (detail.error) return <div className="mt-4"><h2 id={titleId} className="sr-only">account</h2><Failed error={detail.error.status === 404 ? { message: "this account is gone. its payments stay in the money numbers." } : detail.error} retry={detail.reload} /></div>;
  if (!d) return <SheetSkeleton titleId={titleId} />;
  const a = d.account, who = identity(a);
  const live = d.subscriptions.filter((s) => LIVE.includes(s.status)).sort((x, y) => y.createdAt - x.createdAt)[0] ?? null;
  const paid = d.payments.filter((p) => p.status === "paid");
  const liveCents = paid.filter((p) => p.mode !== "test").reduce((s, p) => s + p.amountCents, 0);
  const testCents = paid.filter((p) => p.mode === "test").reduce((s, p) => s + p.amountCents, 0);
  const mrr = live && !live.comp ? (live.interval === "year" ? Math.round(live.totalCents / 12) : live.totalCents) : 0;
  const providers = d.methods.filter((x) => x !== "email");
  const tab: Tab = picked ?? (d.payments.length || live ? "money" : d.devices.length || d.clouds.length || d.workspaces.length ? "installs" : "journey");
  const installs = d.devices.length + d.workspaces.length + d.clouds.length;
  return (
    <div className="flex flex-col">
      <div className="mt-2 flex items-center gap-4">
        <PersonFace id={a.id} size={56} avatarUrl={(a as { avatarUrl?: string }).avatarUrl} />
        <div className="min-w-0">
          <h2 id={titleId} className="truncate text-[22px] font-medium leading-7 tracking-[-0.03em] text-ink">{who.name}</h2>
          <div className="flex min-w-0 items-center gap-1 text-14">
            <a href={`mailto:${a.email}`} className="text-link min-w-0 truncate">{a.email}</a>
            <CopyEmail email={a.email} />
          </div>
        </div>
      </div>
      <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-12 text-ink-3">
        <span className="inline-flex h-5 items-center rounded-full bg-card px-2 text-ink-2">{providers.length ? providers.map((p) => PROVIDER[p] ?? p).join(", ") : "email code"}</span>
        <span>joined {day(a.createdAt)}</span>
        <span>seen {ago(a.lastSeenAt, now)}</span>
        {a.optOut && <span>opted out of analytics</span>}
        <span className="t-id !text-[12px] text-ink-4">{a.id}</span>
      </p>
      <Origin profile={profile.data} />

      <div className="mt-5 grid grid-cols-4 rounded-[20px] bg-card max-sm:grid-cols-2">
        <Cell label="paid in total" money value={usd(liveCents)} note={testCents ? <span className="inline-flex items-center gap-1">+{usd(testCents)} <ModeChip mode="test" /></span> : `${n(paid.length)} payment${paid.length === 1 ? "" : "s"}`} />
        <Cell label="plan" value={live ? live.plan ?? "custom" : "free"} note={live ? (live.comp ? "comp" : `${usd(mrr)} a month`) : "no plan"} />
        <Cell label="apps" value={n(d.devices.length)} note={d.devices[0] ? `${d.devices[0].platform ?? d.devices[0].kind}${d.devices[0].appVersion ? ` ${d.devices[0].appVersion}` : ""}` : "not installed"} />
        <Cell label="bot replies, 30 days" value={n(d.workspaces.reduce((s, w) => s + w.turns30d, 0))} note={`${n(d.workspaces.reduce((s, w) => s + w.bots, 0))} bots, ${n(d.clouds.length)} cloud${d.clouds.length === 1 ? "" : "s"}`} />
      </div>

      <Tabs tab={tab} setTab={setTab} items={[["money", "money", d.payments.length || null], ["installs", "installs and clouds", installs || null], ["journey", "journey", profile.data ? profile.data.sessions.length : null]]} />

      <div role="tabpanel" className="mt-4 min-h-[240px]">
        {tab === "money" && (
          <>
            <PlanLength detail={d} live={live} onChange={onChange} pending={pending} />
            <h3 className="mt-5 px-1 text-13 font-medium text-ink">payments</h3>
            {d.payments.length || d.subscriptions.length ? (
              <ul className="mt-1.5 rounded-[18px] bg-card p-1">
                {d.subscriptions.map((sub) => (
                  <li key={sub.id} className="grid grid-cols-[72px_minmax(0,1fr)_auto_72px] items-center gap-2.5 px-2.5 py-2 text-13 max-sm:grid-cols-[56px_minmax(0,1fr)_64px]">
                    <span className="font-mono text-12 text-ink-4 num">{day(sub.createdAt)}</span>
                    <span className="flex min-w-0 items-center gap-1.5"><span className="truncate text-ink">{sub.plan ?? "custom"} plan{sub.comp ? ", comp" : ""}</span><ModeChip mode={sub.mode} /></span>
                    <span className="truncate text-12 text-ink-3 max-sm:hidden">{endLabel(sub)}</span>
                    <span className="text-end font-mono text-ink-3 num">{sub.comp ? "free" : usd(sub.totalCents)}</span>
                  </li>
                ))}
                {d.payments.map((pay) => (
                  <li key={pay.id} className="grid grid-cols-[72px_minmax(0,1fr)_auto_72px] items-center gap-2.5 px-2.5 py-2 text-13 max-sm:grid-cols-[56px_minmax(0,1fr)_64px]">
                    <span className="font-mono text-12 text-ink-4 num">{day(pay.createdAt)}</span>
                    <span className="flex min-w-0 items-center gap-1.5"><span className="truncate text-ink-2">{pay.description || "payment"}</span><ModeChip mode={pay.mode} /></span>
                    <span className={cx("text-12 max-sm:hidden", pay.status === "paid" ? "text-ink-3" : "text-bad")}>{pay.status}</span>
                    <span className={cx("text-end font-mono num", pay.status === "paid" && pay.mode !== "test" ? "font-medium text-money" : "text-ink-3")}>{usd(pay.amountCents)}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="mt-1.5 rounded-[18px] bg-card px-3 py-4 text-13 text-ink-3">no payments yet.</p>}
            <button type="button" aria-expanded={more} onClick={() => setMore((v) => !v)} className="text-link mt-5 inline-flex h-9 items-center gap-1.5 self-start px-1 text-13">
              give a plan, change it or add a note
              <m.span aria-hidden className="inline-flex" initial={false} animate={{ rotate: more ? 180 : 0 }}><ChevronDown size={14} strokeWidth={1.75} /></m.span>
            </button>
            <AnimatePresence initial={false}>
              {more && (
                <m.div key="more" className="overflow-hidden" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ type: "spring", stiffness: 300, damping: 30 }}>
                  <div className="pt-2"><PlanEditor detail={d} onChange={onChange} /></div>
                </m.div>
              )}
            </AnimatePresence>
          </>
        )}
        {tab === "installs" && (
          <div className="flex flex-col gap-5">
            <Group title="apps signed in">
              {d.devices.length ? d.devices.map((dev) => (
                <li key={dev.id} className="flex min-h-12 items-center justify-between gap-3 px-2.5 py-2">
                  <span className="min-w-0"><span className="block truncate text-14 text-ink">{dev.name}</span><span className="block text-12 text-ink-3">{[dev.kind, dev.platform, dev.appVersion].filter(Boolean).join(" · ")}</span></span>
                  <span className="shrink-0 text-12 text-ink-3">{ago(dev.lastSeenAt, now)}</span>
                </li>
              )) : <Empty>signed in nowhere right now.</Empty>}
            </Group>
            <Group title="workspaces">
              {d.workspaces.length ? d.workspaces.map((ws) => (
                <li key={ws.id} className="flex min-h-12 items-center justify-between gap-3 px-2.5 py-2">
                  <span className="min-w-0"><span className="block truncate text-14 text-ink">{ws.name}</span><span className="block text-12 text-ink-3">{ws.kind} · {ws.version || "version unknown"} · {ws.bots} bots · {n(ws.turns30d)} replies in 30 days</span></span>
                  <span className="shrink-0 text-12 text-ink-3">{ws.lastReportAt ? ago(ws.lastReportAt, now) : "never reported"}</span>
                </li>
              )) : <Empty>no workspace connected.</Empty>}
            </Group>
            <section aria-label="clouds">
              <h3 className="px-1 pb-1.5 text-13 font-medium text-ink">clouds</h3>
              {d.clouds.length ? <CloudTable clouds={d.clouds} onChanged={detail.reload} owner={false} /> : <p className="rounded-[18px] bg-card px-3 py-4 text-13 text-ink-3">no clouds.</p>}
            </section>
          </div>
        )}
        {tab === "journey" && (profile.error ? <Failed error={profile.error} retry={profile.reload} /> : !profile.data ? <div data-skeleton aria-busy="true" className="h-48 animate-pulse rounded-[18px] bg-card" /> : (
          profile.data.sessions.length ? <Journey profile={profile.data} /> : <p className="rounded-[18px] bg-card px-3 py-4 text-13 text-ink-3">nothing recorded yet{a.optOut ? ": they opted out of analytics" : ""}.</p>
        ))}
      </div>
    </div>
  );
}

const Group = ({ title, children }: { title: string; children: ReactNode }) => (
  <section aria-label={title}><h3 className="px-1 pb-1.5 text-13 font-medium text-ink">{title}</h3><ul className="rounded-[18px] bg-card p-1">{children}</ul></section>
);
const Empty = ({ children }: { children: ReactNode }) => <li className="px-2.5 py-3 text-13 text-ink-3">{children}</li>;

function VisitorCard({ id, titleId, pending }: { id: string; titleId: string; pending: MutableRefObject<(() => void) | null> }) {
  const { data, error, reload } = useAdmin<Profile>(`/journeys/${encodeURIComponent(id)}`);
  if (error) return <div className="mt-4"><h2 id={titleId} className="sr-only">visitor</h2><Failed error={error} retry={reload} /></div>;
  if (!data) return <SheetSkeleton titleId={titleId} />;
  if (data.account) return <AccountCard id={data.account.id} titleId={titleId} pending={pending} />;
  const who = identity({ id: data.seed });
  return (
    <div className="flex flex-col">
      <div className="mt-2 flex items-center gap-4">
        <PersonFace id={data.seed} size={56} anonymous />
        <div className="min-w-0">
          <h2 id={titleId} className="truncate text-[22px] font-medium leading-7 tracking-[-0.03em] text-ink">{who.name}</h2>
          <p className="text-13 text-ink-3">anonymous visitor, no account{data.installs ? `, ${n(data.installs)} app install${data.installs === 1 ? "" : "s"}` : ""}</p>
        </div>
      </div>
      <Origin profile={data} />
      <div className="mt-5 grid grid-cols-3 rounded-[20px] bg-card max-sm:grid-cols-2">
        <Cell label="visits" value={n(data.stats.visits)} note={`${n(data.stats.pageviews)} pages`} />
        <Cell label="first seen" value={data.stats.firstSeen ? day(data.stats.firstSeen) : "-"} note={stamp(data.stats.firstSeen).slice(11)} />
        <Cell label="device" value={data.where.device ?? "unknown"} note={data.where.os ?? undefined} />
      </div>
      <h3 className="mt-6 px-1 text-13 font-medium text-ink">journey</h3>
      <div className="mt-1">{data.sessions.length ? <Journey profile={data} /> : <p className="text-13 text-ink-3">nothing recorded.</p>}</div>
    </div>
  );
}
