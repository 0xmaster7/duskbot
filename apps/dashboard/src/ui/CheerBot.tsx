import { useMemo } from "react";
import { useCheer } from "../lib/cheer";
import { Mascot, useReducedMotion } from "./Mascot";

const SPARKS = ["#3fbdfb", "#c8f04a", "#ff7ab6", "#ffd84a", "#8b6cff"];

/** the corner bot that cheers a milestone; the words go out as a toast, so this stays decoration */
export function CheerBot() {
  const cheer = useCheer();
  const reduced = useReducedMotion();
  const sparks = useMemo(() => (cheer && !reduced ? Array.from({ length: 10 }, (_, i) => ({ i, dx: Math.round((Math.random() - 0.5) * 140), dy: Math.round(-40 - Math.random() * 90), colour: SPARKS[i % SPARKS.length]! })) : []), [cheer?.id, reduced]);
  if (!cheer) return null;
  return (
    <div key={cheer.id} aria-hidden className="toast-in pointer-events-none fixed bottom-20 right-6 z-50 max-sm:bottom-24 max-sm:right-4">
      <Mascot body="kit" color="blue" size={64} state="celebrate" still={reduced} />
      {sparks.map((s) => <i key={s.i} className="spark" style={{ left: "50%", top: "30%", background: s.colour, ["--dx" as string]: `${s.dx}px`, ["--dy" as string]: `${s.dy}px` }} />)}
    </div>
  );
}
