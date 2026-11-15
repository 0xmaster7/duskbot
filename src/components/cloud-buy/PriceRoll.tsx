// The buy button's label with only the price digits that change rolling: each digit is a drum (0 to 9 in a column)
// that springs to its value, keyed from the right so $15 -> $49 turns two drums and the $ sits still. The label stays one
// plain text node (what sizes the button and what a screen reader hears); the drawn copy over it carries no text of its
// own. No hooks: the sheet's tests render it as plain functions.
import { motion } from "motion/react";
import type { ReactNode } from "react";
import { t } from "@/lib/i18n";

const STRIP = "0\n1\n2\n3\n4\n5\n6\n7\n8\n9";
const DRAWN = "h-[1.25em] leading-[1.25em] before:whitespace-pre before:content-[attr(data-text)]";

function Drum({ digit, index, still }: { digit: number; index: number; still: boolean }) {
  return <span className="relative h-[1.25em] overflow-clip [mask-image:linear-gradient(transparent,#000_14%,#000_86%,transparent)]">
    <motion.span data-text={STRIP} className={`block text-center ${DRAWN.replace("h-[1.25em] ", "")}`}
      initial={false} animate={{ y: `${-digit * 1.25}em` }}
      transition={still ? { duration: 0 } : { type: "spring", stiffness: 260, damping: 22 + 2 * index }} />
  </span>;
}

function PriceRoll({ value }: { value: string }) {
  const still = globalThis.window?.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
  const chars = [...value];
  return <>{chars.map((char, i) => {
    const key = chars.length - i;
    return /\d/.test(char) ? <Drum key={`d${key}`} digit={Number(char)} index={i} still={still} /> : <span key={`c${key}${char}`} data-text={char} className={DRAWN} />;
  })}</>;
}

/** The label for "Get {plan} for {price}/month"; the button it goes in is `relative`. */
export function buyLabel(plan: string, price: string): ReactNode {
  const words = t("cloudBuy.buy", { plan, price });
  const [before, after] = t("cloudBuy.buy", { plan, price: "\u0000" }).split("\u0000");
  if (after === undefined) return words;
  return <>
    <span aria-hidden="true" className="pointer-events-none absolute inset-0 flex items-center justify-center tabular-nums">
      <span data-text={before} className={DRAWN} /><PriceRoll value={price} /><span data-text={after} className={DRAWN} />
    </span>
    <span className="text-transparent tabular-nums">{words}</span>
  </>;
}
