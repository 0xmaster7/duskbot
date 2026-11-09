import { useState } from "react";
import type { CheckoutSource } from "../data/contracts";
import { useCloud } from "../data/cloud";
import { dollars } from "../data/pricing";
import { useSession } from "../data/session";
import { Modal } from "../ui/controls";

/** buy a pack of AI credits: three amounts, one tap each */
export function BuyCredits({ open, source, onClose }: { source: CheckoutSource; open: boolean; onClose(): void }) {
  const { catalog, checkout } = useCloud();
  const { toast } = useSession();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const buy = async (pack: string, amount: number) => {
    setBusy(pack); setError(null);
    try { if (await checkout({ source, kind: "credits", pack })) { toast(`Added ${dollars(amount)} of AI credits`); onClose(); } }
    catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Add AI credits">
      <p>For bots that use our AI instead of your own accounts. Credits never expire.</p>
      <div className="mt-5 grid grid-cols-3 gap-2">
        {(catalog?.creditPacks ?? []).map((p) => (
          <button key={p.id} type="button" disabled={busy !== null} onClick={() => void buy(p.id, p.usd)} className="press-soft hover-outline num h-14 rounded-[12px] bg-card-2 text-17 font-medium text-ink disabled:opacity-45">
            {busy === p.id ? <span className="text-13 font-normal text-ink-3">Opening</span> : dollars(p.usd)}
          </button>
        ))}
      </div>
      {error && <p role="alert" className="mt-3 text-13 text-bad">{error}</p>}
    </Modal>
  );
}
