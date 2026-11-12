import { useEffect, useRef, useState } from "react";
import { useCloud } from "../data/cloud";
import type { CloudDesktop, DesktopTier, PlanCatalog, Selection } from "../data/contracts";
import { dollars, planTotal, specLine } from "../data/pricing";
import { useSession } from "../data/session";
import { ApiError } from "../lib/api";
import { longDate } from "../lib/format";
import { Modal } from "../ui/controls";
import { Button, cx } from "../ui/kit";

const UNDO_MS = 3000;
const money = (n: number) => dollars(n, !Number.isInteger(Math.round(n * 100) / 100));

type Quote = { state: "loading" } | { state: "ready"; usd: number } | { state: "error"; message: string };

function plainError(e: unknown): string {
  if (e instanceof ApiError && e.code === "price_changed") return "the price just changed. check the new amount and try again.";
  if (e instanceof ApiError && e.code === "offline") return "can't reach dusk bot. check your connection and try again.";
  return (e as Error).message || "that didn't go through. try again.";
}

export function ResizeDialog({ open, onClose, cloud, catalog, focus }: { open: boolean; onClose(): void; cloud: CloudDesktop; catalog: PlanCatalog; focus: DesktopTier["id"] | null }) {
  const { billing, changeCharge, changePlan } = useCloud();
  const { toast } = useSession();
  const sub = billing?.subscription ?? null;
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [pending, setPending] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectionFor = (id: DesktopTier["id"]): Selection | null => (sub ? { ...sub.selection, desktop: id, size: null } : null);

  const quote = (id: DesktopTier["id"]) => {
    const selection = selectionFor(id);
    if (!selection) return;
    setQuotes((q) => ({ ...q, [id]: { state: "loading" } }));
    changeCharge(selection).then(
      (usd) => setQuotes((q) => ({ ...q, [id]: { state: "ready", usd } })),
      (e) => setQuotes((q) => ({ ...q, [id]: { state: "error", message: plainError(e) } })),
    );
  };

  // every price is in before anyone clicks, so the button can say exactly what it charges
  useEffect(() => {
    if (!open || !sub) return;
    setErrors({}); setPending(null);
    for (const d of catalog.desktops) if (d.id !== cloud.tier) quote(d.id);
  }, [open, sub?.id, cloud.tier]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const apply = async (d: DesktopTier) => {
    const selection = selectionFor(d.id), q = quotes[d.id];
    setPending(null);
    if (!selection || q?.state !== "ready") return;
    setBusy(d.id);
    try {
      await changePlan(selection, q.usd);
      toast(`switching ${cloud.name} to ${d.name}. it restarts once, in under a minute.`);
      onClose();
    } catch (e) {
      setErrors((x) => ({ ...x, [d.id]: plainError(e) }));
      if (e instanceof ApiError && e.code === "price_changed") quote(d.id);
    } finally { setBusy(null); }
  };
  const press = (d: DesktopTier) => {
    if (timer.current) clearTimeout(timer.current);
    if (pending === d.id) { timer.current = null; setPending(null); return; }
    setErrors((x) => ({ ...x, [d.id]: "" }));
    setPending(d.id);
    timer.current = setTimeout(() => { timer.current = null; void apply(d); }, UNDO_MS);
  };
  const close = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } setPending(null); onClose(); };

  return (
    <Modal open={open} onClose={close} title={`resize ${cloud.name}`} wide>
      <p>it restarts once, usually in under a minute. bots, files and logins come along. a bigger size charges the difference for the rest of this period today; each button says how much.</p>
      <ul className="mt-4 flex flex-col gap-1">
        {catalog.desktops.map((d) => {
          const current = d.id === cloud.tier;
          const selection = selectionFor(d.id);
          const total = selection ? planTotal(catalog, selection) : null;
          const q = quotes[d.id];
          const error = errors[d.id] || (q?.state === "error" ? q.message : "");
          const waiting = pending === d.id;
          const label = busy === d.id ? "switching" : waiting ? "undo" : error ? "try again" : q?.state === "ready" ? (q.usd > 0 ? `switch to ${d.name} · ${money(q.usd)} today` : `switch to ${d.name} · nothing today`) : `switch to ${d.name}`;
          return (
            <li key={d.id} className={cx("grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-3 rounded-[18px] px-4 py-3.5", (current || focus === d.id) && "bg-btn")}>
              <div className="min-w-0">
                <p className="text-15 text-ink">{d.name}{current && <span className="ms-2 text-13 text-ink-3">current</span>}</p>
                <p className="num mt-0.5 text-13 text-ink-3">{specLine(d)}{d.priority ? ", priority wake" : ""}</p>
              </div>
              {total && (
                <div className="text-end">
                  <p className="num text-15 text-ink">{total.amount}<span className="text-ink-3">{total.unit}</span></p>
                  <p className="text-12 text-ink-3">{total.note}</p>
                </div>
              )}
              {!current && (
                <div className="col-span-2 flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
                  {error && <p role="alert" className="me-auto text-13 text-bad">{error}</p>}
                  {waiting && <p role="status" className="me-auto text-13 text-ink-2">switching to {d.name} in a moment</p>}
                  <Button size="sm" variant={!waiting && focus === d.id ? "primary" : "outline"} className="max-sm:w-full"
                    disabled={!sub || busy !== null || (pending !== null && !waiting) || (!error && q?.state !== "ready")}
                    aria-busy={busy === d.id || q?.state === "loading"}
                    onClick={() => (error && !waiting ? (q?.state === "ready" ? press(d) : quote(d.id)) : press(d))}>
                    {label}
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {sub && <p className="mt-3 text-13 text-ink-3">from {longDate(sub.currentPeriodEnd ?? 0)} you pay the new size's price above.</p>}
    </Modal>
  );
}
