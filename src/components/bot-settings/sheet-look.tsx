import { createContext, useContext, type ReactNode } from "react";

/** Set by the bot's settings sheet: a section names each card by a label above it, Grok's way, with no title or
 * description inside. */
export const SheetLook = createContext(false);

export function useSheetLook(): boolean {
  return useContext(SheetLook);
}

/** In the sheet, a card under its label; anywhere else the card as it is. */
export function SheetGroup({ label, children }: { label: ReactNode; children: ReactNode }) {
  if (!useContext(SheetLook)) return <>{children}</>;
  return (
    <section data-sheet-group="" className="flex flex-col gap-2">
      <h3 className="m-0 pl-3.5 text-[12px] font-normal leading-4 tracking-[0.01em] text-ink/68">{label}</h3>
      {children}
    </section>
  );
}
