import { useId, useState } from "react";
import { ChevronDown } from "@/icons";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { Art, type ArtName } from "./ui/Art";
import { deviceWord } from "./vps-link/parts";

const MOVES: ReadonlyArray<{ art: ArtName; key: LocaleKey }> = [
  { art: "bubbles", key: "whatMoves.bots" },
  { art: "notebook", key: "whatMoves.memory" },
  { art: "clock", key: "whatMoves.routines" },
  { art: "shield", key: "whatMoves.logins" },
  { art: "plug", key: "whatMoves.apps" },
];

function MovesList({ wide }: { wide: boolean }) {
  return <ul className={cn("grid gap-x-6 gap-y-2", wide ? "grid-cols-1 sm:grid-cols-3" : "grid-cols-1")}>
    {MOVES.map(item => <li key={item.key} className="grid grid-cols-[22px_minmax(0,1fr)] items-center gap-2.5">
      <Art name={item.art} className="size-[22px] object-contain" />
      <span className="text-[13px] leading-[18px] text-ink [text-wrap:pretty]">{t(item.key)}</span>
    </li>)}
  </ul>;
}

/** The plans sheet opened to move bots: what moves once paid, and that this computer keeps a copy. */
export function WhatMovesPanel() {
  return <section aria-label={t("whatMoves.title")} data-what-moves="" className="flex flex-col gap-3 rounded-[14px] bg-ink/[0.035] px-4 py-3.5">
    <p className="text-[12px] font-medium leading-4 text-ink-tertiary">{t("whatMoves.lead")}</p>
    <MovesList wide />
    <p className="text-[12px] leading-4 text-ink-secondary">{t("whatMoves.copy", { device: deviceWord() })}</p>
  </section>;
}

/** The move offer's one line, with the full list behind What moves. */
export function WhatMovesLine() {
  const [open, setOpen] = useState(false);
  const id = useId();
  const device = deviceWord();
  return <div data-what-moves={open ? "open" : "closed"} className="flex w-full flex-col items-center gap-2">
    <p className="m-0 text-[13px] leading-[18px] text-ink-secondary text-pretty">
      {t("whatMoves.line", { device })}{" "}
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}
        className="inline-flex cursor-pointer items-center gap-0.5 rounded-sm font-medium text-ink underline decoration-ink/30 underline-offset-[3px] hover:decoration-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
        {t("whatMoves.title")}
        <ChevronDown size={14} aria-hidden="true" className={cn("transition-transform duration-150 ease-out motion-reduce:transition-none", open && "rotate-180")} />
      </button>
    </p>
    <div id={id} hidden={!open} className="w-full rounded-[14px] bg-ink/[0.035] px-4 py-3 text-start">
      <MovesList wide={false} />
      <p className="m-0 mt-2.5 text-[12px] leading-4 text-ink-secondary">{t("whatMoves.copy", { device })}</p>
    </div>
  </div>;
}
