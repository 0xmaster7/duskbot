import { cx } from "../ui/kit";
import { Users } from "@/icons";
import { adminData, adminTests, setAdminData, setAdminTests } from "./api";

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
