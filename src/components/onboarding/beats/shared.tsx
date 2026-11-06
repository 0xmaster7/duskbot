import type { CSSProperties } from "react";
import type { MausMotion, MausState } from "@/lib/mascot";

export interface BeatProps {
  onNext: () => void;
  onSkip: () => void;
  setMascot: (state: MausState) => void;
  bump: (motion: Exclude<MausMotion, "none">) => void;
}

export function staggerIndex(i: number): CSSProperties {
  return { "--i": i } as CSSProperties;
}

