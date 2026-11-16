import { cx } from "../ui/kit";
import { Users } from "@/icons";
import { adminData, adminMoney, adminTests, MONEY_KEY, setAdminData, setAdminTests } from "./api";

/** whose analytics the pages show: the live site's (read only) or this service's own; people, clouds and revenue stay this service's */
export function DataSwitch({ live }: { live: string }) {
  const current = adminData();
  const pick = (value: "live" | "own") => { if (value === current) return; setAdminData(value); location.reload(); };
  return (
    <div role="radiogroup" aria-label="analytics from" className="mb-1 flex w-fit gap-0.5 rounded-full bg-card p-0.5 text-12" title="the analytics pages read this site; people, clouds and revenue are always this service's">
      {([["live", live], ["own", "preview"]] as const).map(([value, label]) => (
        <button key={value} type="button" role="radio" aria-checked={current === value} onClick={() => pick(value)}
          className={cx("h-7 rounded-full px-2.5 transition-colors duration-150 ease-out", current === value ? "bg-bg text-ink" : "text-ink-3 hover:text-ink-2")}>{label}</button>
      ))}
    </div>
  );
}

/** test accounts (qa, harness and review sign-ups) stay out of people, signups and revenue unless this is on */
export function TestSwitch() {
  const shown = adminTests();
  return (
    <button type="button" aria-pressed={shown} onClick={() => { setAdminTests(!shown); location.reload(); }}
      className={cx("hover-ghost mt-2 flex h-9 items-center gap-2 rounded-full px-2 text-13 max-lg:h-11", shown ? "text-ink" : "text-ink-3")}>
      <Users size={15} strokeWidth={1.75} aria-hidden />{shown ? "hide test accounts" : "show test accounts"}
    </button>
  );
}

/** which money every number counts; live by default, so test checkouts never read as revenue */
export function MoneySwitch() {
  const current = adminMoney();
  const pick = (value: "live" | "test" | "all") => {
    if (value === current) return;
    try { if (value === "live") localStorage.removeItem(MONEY_KEY); else localStorage.setItem(MONEY_KEY, value); } catch { /* private mode keeps live */ }
    location.reload();
  };
  return (
    <div className="mt-1 flex items-center gap-2 px-2">
      <span id="admin-money-label" className="text-12 text-ink-3">money</span>
      <div role="radiogroup" aria-labelledby="admin-money-label" className="flex w-fit gap-0.5 rounded-full bg-card p-0.5 text-12" title="live counts real payments only; test is dodo test mode">
        {(["live", "test", "all"] as const).map((value) => (
          <button key={value} type="button" role="radio" aria-checked={current === value} onClick={() => pick(value)}
            className={cx("h-7 rounded-full px-2.5 transition-colors duration-150 ease-out", current === value ? "bg-bg text-ink" : "text-ink-3 hover:text-ink-2")}>{value}</button>
        ))}
      </div>
    </div>
  );
}

/** a plain line over every page when it isn't production's data, so staging numbers are never read as real */
export function StagingTag({ environment, live }: { environment: string; live: string | null | undefined }) {
  if (environment === "production") return null;
  const money = adminMoney();
  const analytics = live && adminData() === "live" ? `visits from ${live}; ` : "";
  return (
    <p className="mb-5 flex flex-wrap items-center gap-2 text-12 text-ink-3">
      <span className="inline-flex h-[22px] items-center rounded-full bg-wash-lemon px-2 text-ink">{environment === "preview" ? "staging data" : `${environment} data`}</span>
      <span>{analytics}people, money and clouds from {environment === "preview" ? "preview" : "this service"}, counting {money === "all" ? "live and test money" : `${money} money only`}{money !== "test" && !adminTests() ? ", test accounts left out" : ""}.</span>
    </p>
  );
}
