import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Pause, Play } from "@/icons";
import { Segmented, cx } from "../ui/kit";
import { ago } from "../lib/format";
import { Link } from "../lib/router";
import { useNow } from "../lib/now";
import { useReducedMotion } from "../ui/Mascot";
import { useAdmin } from "./api";
import { centroid, countryName } from "./geo";
import { avatarOf, friendlyName } from "./names";
import { AdminHeader, Failed, Loading, n } from "./ui";
import { Avatar } from "./kit";

const Globe = lazy(() => import("./globe/Globe"));

export interface LiveItem { id: string; at: number; name: string; seed: string; email: string | null; customer: boolean; page: string | null; goal: string | null; source: string | null; country: string | null; city: string | null; lat: number | null; lon: number | null }
export interface LiveAnswer { now: number; minutes: number; online: { site: number; app: number }; here: LiveItem[]; feed: LiveItem[] }

export const SAYS: Record<string, (item: LiveItem) => string> = {
  site_view: (i) => `visited ${i.page ?? "/"}`, site_goal: (i) => i.goal === "waitlist_join" ? "joined the waitlist" : i.goal === "cta_click" ? "clicked sign up" : i.goal === "download_click" ? "clicked download" : (i.goal ?? "goal").replace(/_/g, " "),
  signup: () => "signed up", app_paired: () => "paired an app", first_bot_reply: () => "got a first bot reply", checkout_paid: () => "paid", app_open: () => "opened the app",
};
const BIG = new Set(["signup", "app_paired", "first_bot_reply", "checkout_paid"]);
const place = (item: LiveItem) => item.country ? `${item.city ? `${item.city}, ` : ""}${countryName(item.country)}` : null;

/** where a person is: Cloudflare's coordinates when present, else their country's middle, spread a little so markers do not sit on each other */
export function spot(item: LiveItem): [number, number] | null {
  if (item.lat !== null && item.lon !== null) return [item.lat, item.lon];
  const c = centroid(item.country);
  if (!c) return null;
  const h = [...item.seed].reduce((sum, ch) => (sum * 31 + ch.charCodeAt(0)) >>> 0, 7);
  return [c[1] + ((h % 100) / 100 - 0.5) * 3, c[0] + (((h >>> 8) % 100) / 100 - 0.5) * 3];
}

/** the people seen in the five minutes before `at`, one marker each, where they are */
export function pointsAt(feed: LiveItem[], at: number) {
  const latest = new Map<string, LiveItem>();
  for (const item of feed) if (item.at <= at && item.at > at - 5 * 60_000 && !latest.has(item.seed)) latest.set(item.seed, item);
  return [...latest.values()].flatMap((item) => {
    const s = spot(item);
    return s ? [{ id: item.seed, lat: s[0], lon: s[1], label: item.email ?? friendlyName(item.seed), detail: (SAYS[item.name] ?? (() => item.name))(item), avatar: (({ body, ink }) => ({ body, colour: ink }))(avatarOf(item.seed)), customer: item.customer, fresh: at - item.at < 60_000 }] : [];
  });
}

export function LivePage() {
  const { data, error, loading, reload } = useAdmin<LiveAnswer>("/realtime?minutes=30", 10_000);
  const [mode, setMode] = useState<"3d" | "2d">("3d");
  const [selected, setSelected] = useState<string | null>(null);
  const [replay, setReplay] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const reduced = useReducedMotion();
  const now = useNow(5_000);
  const span = 30 * 60_000;
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => setReplay((at) => { const next = (at ?? (data?.now ?? Date.now()) - span) + 60_000; if (next >= (data?.now ?? Date.now())) { setPlaying(false); return null; } return next; }), reduced ? 900 : 450);
    return () => clearInterval(timer);
  }, [playing, data?.now, span, reduced]);
  const points = useMemo(() => data ? pointsAt(data.feed, replay ?? data.now) : [], [data, replay]);
  const feed = data ? (replay === null ? data.feed : data.feed.filter((item) => item.at <= replay)) : [];
  const located = points.length, here = data?.here.length ?? 0;
  return (
    <>
      <AdminHeader title="live" sub="who is here now, and what just happened" action={<Segmented<"3d" | "2d"> label="globe or map" value={mode} onChange={setMode} options={[{ value: "3d", label: "globe" }, { value: "2d", label: "map" }]} />} />
      {error && <Failed error={error} retry={reload} />}
      {!data && loading && <Loading rows={8} />}
      {data && (
        <div className="grid grid-cols-[minmax(0,1fr)_340px] gap-6 max-lg:grid-cols-1">
          <div className="min-w-0">
            <div className="mb-3 flex flex-wrap items-end gap-6">
              <div><div className="flex items-center gap-2 text-13 text-ink-3"><span className="live-dot text-good" data-live={data.online.site > 0} aria-hidden /> on the site</div><div className="font-mono text-[32px] font-medium leading-9 tracking-[-0.04em] num">{n(data.online.site)}</div></div>
              <div><div className="text-13 text-ink-3">in the apps</div><div className="font-mono text-[32px] font-medium leading-9 tracking-[-0.04em] num">{n(data.online.app)}</div></div>
              <div><div className="text-13 text-ink-3">events, 30 min</div><div className="font-mono text-[32px] font-medium leading-9 tracking-[-0.04em] text-ink-2 num">{n(data.feed.length)}</div></div>
            </div>
            <div className="rounded-[28px] bg-card p-3">
              <Suspense fallback={<div className="grid aspect-square max-h-[640px] w-full place-items-center rounded-[24px] text-13 text-ink-3" aria-busy="true">loading the globe</div>}>
                <Globe points={points} mode={mode} selected={selected} onSelect={setSelected} summary={`${located} ${located === 1 ? "person" : "people"} on the ${mode === "3d" ? "globe" : "map"}${replay !== null ? ", replaying" : ""}`} />
              </Suspense>
              <div className="mt-3 flex items-center gap-3 px-1">
                <button type="button" onClick={() => { if (playing) setPlaying(false); else { setReplay((at) => at ?? data.now - span); setPlaying(true); } }} aria-label={playing ? "pause the replay" : "replay the last 30 minutes"}
                  className="press hover-outline grid size-10 shrink-0 place-items-center rounded-full bg-btn text-ink">{playing ? <Pause size={16} strokeWidth={1.75} /> : <Play size={16} strokeWidth={1.75} />}</button>
                <label className="sr-only" htmlFor="replay-at">replay time</label>
                <input id="replay-at" type="range" className="range flex-1" min={data.now - span} max={data.now} step={15_000} value={replay ?? data.now}
                  onChange={(e) => { setPlaying(false); const v = Number(e.target.value); setReplay(v >= data.now - 10_000 ? null : v); }} style={{ ["--fill" as string]: `${(((replay ?? data.now) - (data.now - span)) / span) * 100}%` }}
                  aria-valuetext={replay === null ? "now" : `${Math.round((data.now - replay) / 60_000)} minutes ago`} />
                <span className="w-24 text-end font-mono text-12 text-ink-3">{replay === null ? "now" : `-${Math.round((data.now - replay) / 60_000)} min`}</span>
              </div>
            </div>
            <p className="mt-3 text-12 text-ink-4">{here - located > 0 ? `${here - located} visitor${here - located === 1 ? "" : "s"} have no location. ` : ""}places come from cloudflare: a city when cloudflare sends one, else the middle of the country.</p>
          </div>
          <section aria-label="live feed" className="min-w-0">
            <h2 className="mb-3 text-16 font-medium tracking-[-0.02em] text-ink">just now</h2>
            {feed.length ? (
              <ol className="flex max-h-[720px] flex-col gap-0.5 overflow-y-auto">
                {feed.slice(0, 80).map((item) => (
                  <li key={item.id}>
                    <Link to={`/admin/people/visitors?person=${encodeURIComponent(item.seed)}`} className={cx("hover-row flex items-center gap-3 rounded-[14px] px-2 py-2", selected === item.seed && "bg-card-2", BIG.has(item.name) && "bg-lime")}>
                      <Avatar seed={item.seed} size={24} customer={item.customer} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-13 text-ink"><span className="font-medium">{item.email ?? friendlyName(item.seed)}</span> {(SAYS[item.name] ?? (() => item.name))(item)}</span>
                        <span className="block truncate text-12 text-ink-3">{[place(item), item.source && item.source !== "direct" ? `from ${item.source}` : null].filter(Boolean).join(" · ") || " "}</span>
                      </span>
                      <span className="shrink-0 text-12 text-ink-4">{ago(item.at, now)}</span>
                    </Link>
                  </li>
                ))}
              </ol>
            ) : <p className="rounded-[18px] bg-card px-4 py-6 text-center text-14 text-ink-3">quiet for the last 30 minutes.</p>}
          </section>
        </div>
      )}
    </>
  );
}
