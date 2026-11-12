// The weekly allowance outside Usage & Billing: one quiet app notice at 80% and one at 100% (never a chat line), and
// the small line above the message box while the week's limit is reached. Owners only: anyone else gets nothing.
import { useEffect, useState } from "react";
import { api } from "@/state/store";
import { whenServerHas } from "./server-compat";
import type { AllowanceReport } from "./spend";

const POLL_MS = 60_000;

/** Reads `load` now, on focus and every minute in the background; null until it answers, or while it is refused. */
function usePolled<T>(load: () => Promise<T>): [T | null, (next: T | null) => void] {
  const [value, setValue] = useState<T | null>(null);
  useEffect(() => {
    let active = true;
    const read = () => void load().then((next) => { if (active) setValue(next); }, () => { if (active) setValue(null); });
    read();
    const timer = setInterval(read, POLL_MS);
    window.addEventListener("focus", read);
    return () => { active = false; clearInterval(timer); window.removeEventListener("focus", read); };
  }, [load]);
  return [value, setValue];
}

const readNotice = () => whenServerHas("allowance", () => api<{ notice: "near" | "over" | null }>("/api/usage/allowance/notice", { background: true }));
const readAllowance = () => whenServerHas("allowance", () => api<AllowanceReport>("/api/usage/allowance", { background: true }));

/** The notice waiting to be shown once, and the call that marks it seen. */
export function useAllowanceNotice(): { level: "near" | "over"; seen: () => void } | null {
  const [answer, setAnswer] = usePolled(readNotice);
  if (!answer?.notice) return null;
  return { level: answer.notice, seen: () => { setAnswer({ notice: null }); void api("/api/usage/allowance/notice/seen", { method: "POST", body: "{}" }).catch(() => {}); } };
}

/** The allowance while the week's limit is reached; null otherwise. */
export function useLimitReached(): { report: AllowanceReport; update: (next: AllowanceReport) => void } | null {
  const [report, setReport] = usePolled(readAllowance);
  return report?.level === "over" ? { report, update: setReport } : null;
}
