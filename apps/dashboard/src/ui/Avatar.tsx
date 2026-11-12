import { useState } from "react";
import { cx } from "./kit";
import { Mascot } from "./Mascot";

const PASTELS = ["#c2ecfc", "#d0cefb", "#ffc4dd", "#fff3a0", "#c9f63f"] as const;
const MASCOTS = ["blue", "purple", "pink", "yellow", "green"] as const;

export function pastelIndex(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) % PASTELS.length;
}

export function initialOf(name: string): string | null {
  const match = /[\p{L}\p{N}]/u.exec(name);
  return match ? match[0].toLowerCase() : null;
}

export function Avatar({ name, email, photo = null, size = 36, className }: { name: string; email: string; photo?: string | null; size?: number; className?: string }) {
  const [broken, setBroken] = useState(false);
  const i = pastelIndex(email.trim().toLowerCase());
  const initial = initialOf(name);
  const box = cx("grid shrink-0 place-items-center overflow-hidden rounded-full", className);
  if (photo && !broken) return <img src={photo} alt="" width={size} height={size} referrerPolicy="no-referrer" onError={() => setBroken(true)} className={box} style={{ width: size, height: size }} aria-hidden />;
  return (
    <span className={box} style={{ width: size, height: size, background: PASTELS[i], color: "#1b1b1f" }} aria-hidden>
      {initial ? <span className="font-medium leading-none" style={{ fontSize: Math.round(size * 0.4) }}>{initial}</span> : <Mascot color={MASCOTS[i]} size={Math.round(size * 0.7)} still />}
    </span>
  );
}
