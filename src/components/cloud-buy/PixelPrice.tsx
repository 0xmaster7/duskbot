// The plan's price drawn like the landing's giant pixel "free": 2-unit strokes on a 14-unit cap with stepped shoulders,
// cut out of the meadow (sky over grass). Digits are tabular drums keyed from the right, so moving between plans rolls
// only the digits that change; the rest stay still. Reduced motion swaps a digit with a short fade instead. No hooks:
// the cloud sheet's tests render it as a plain function.
import { motion } from "motion/react";
import meadow from "@/assets/pixel-art/price-meadow.webp";
import { cn } from "@/lib/cn";
import { SPRING } from "@/lib/motion-presets";

type Glyph = { w: number; r: ReadonlyArray<readonly [number, number, number, number]> };
const CAP = 14, GAP = 2;
/** every digit 8 units wide so a drum never changes width; the 1 stands on a foot to fill its cell */
const DIGITS: Record<string, Glyph> = {
  "0": { w: 8, r: [[1, 1, 6, 2], [0, 2, 2, 10], [6, 2, 2, 10], [1, 11, 6, 2]] },
  "1": { w: 8, r: [[3, 1, 2, 2], [1, 2, 3, 2], [3, 1, 2, 12], [1, 11, 6, 2]] },
  "2": { w: 8, r: [[1, 1, 6, 2], [0, 2, 2, 2], [6, 2, 2, 4], [1, 6, 6, 2], [0, 7, 2, 4], [0, 11, 8, 2]] },
  "3": { w: 8, r: [[0, 1, 7, 2], [6, 2, 2, 4], [2, 6, 5, 2], [6, 7, 2, 5], [0, 11, 7, 2]] },
  "4": { w: 8, r: [[0, 1, 2, 7], [0, 6, 8, 2], [6, 1, 2, 12]] },
  "5": { w: 8, r: [[0, 1, 8, 2], [0, 2, 2, 5], [0, 6, 7, 2], [6, 7, 2, 5], [0, 11, 7, 2]] },
  "6": { w: 8, r: [[1, 1, 7, 2], [0, 2, 2, 10], [1, 6, 6, 2], [6, 7, 2, 5], [1, 11, 6, 2]] },
  "7": { w: 8, r: [[0, 1, 8, 2], [6, 2, 2, 4], [4, 5, 3, 3], [3, 8, 2, 5]] },
  "8": { w: 8, r: [[1, 1, 6, 2], [0, 2, 2, 4], [6, 2, 2, 4], [1, 6, 6, 2], [0, 7, 2, 5], [6, 7, 2, 5], [1, 11, 6, 2]] },
  "9": { w: 8, r: [[1, 1, 6, 2], [0, 2, 2, 5], [6, 2, 2, 10], [1, 6, 6, 2], [0, 11, 7, 2]] },
};
const MARKS: Record<string, Glyph> = {
  "$": { w: 8, r: [[3, 0, 2, 14], [1, 2, 7, 2], [0, 3, 2, 3], [1, 6, 6, 2], [6, 7, 2, 3], [0, 10, 7, 2]] },
  ",": { w: 3, r: [[1, 11, 2, 2], [0, 13, 2, 1]] },
  ".": { w: 2, r: [[0, 11, 2, 2]] },
};
const glyphOf = (char: string) => DIGITS[char] ?? MARKS[char];
const NAME: Record<string, string> = { "$": "dollar", ",": "comma", ".": "dot" };

/** Whether the price can be drawn in pixels; anything else (another currency's sign, say) is set in type instead. */
export function pixelPriceFits(price: string): boolean {
  return [...price].every(char => glyphOf(char));
}
/** The price's width in pixel units, so the sheet can size every plan's price alike. */
export function pixelPriceUnits(price: string): number {
  return [...price].reduce((sum, char) => sum + (glyphOf(char)?.w ?? 0) + GAP, 0) - GAP;
}

// the meadow's sky ends a little past half the image: scaled so the grass starts about two thirds down the figures
const TALL = 15.5, TILE = TALL * 1000 / 640;

/** One glyph cut out of the meadow, the meadow lined up with where the glyph sits in the whole price (`at`). */
function Cut({ char, at, unit }: { char: string; at: number; unit: number }) {
  const glyph = glyphOf(char)!, id = `cloud-price-${NAME[char] ?? char}`;
  const first = Math.floor(at / TILE), last = Math.floor((at + glyph.w) / TILE);
  return <svg viewBox={`0 0 ${glyph.w} ${CAP}`} width={glyph.w * unit} height={CAP * unit} shapeRendering="crispEdges" className="block">
    <defs><clipPath id={id}>{glyph.r.map(([x, y, w, h], i) => <rect key={i} x={x} y={y} width={w} height={h} />)}</clipPath></defs>
    <g clipPath={`url(#${id})`}>
      {Array.from({ length: last - first + 1 }, (_, i) => <image key={i} href={meadow} x={(first + i) * TILE - at - 0.2} y={0} width={TILE + 0.4} height={TALL}
        preserveAspectRatio="none" className="[image-rendering:pixelated]" />)}
      <rect width={glyph.w} height={CAP} className="fill-(--cloud-price-dim)" />
    </g>
  </svg>;
}

/** A digit's cell: the ten digits in a column, moved so this one shows. */
function Drum({ digit, at, unit, still }: { digit: number; at: number; unit: number; still: boolean }) {
  return <span className="block overflow-clip" style={{ width: 8 * unit, height: CAP * unit }}>
    <motion.span key={still ? digit : "drum"} className={cn("block", still && "animate-fade-in")} initial={false}
      animate={{ y: -digit * CAP * unit }} transition={still ? { duration: 0 } : SPRING.layout}>
      {Object.keys(DIGITS).map(char => <Cut key={char} char={char} at={at} unit={unit} />)}
    </motion.span>
  </span>;
}

/** `label` is what a screen reader hears ("$50 a month"); the drawing itself is hidden from it. */
export function PixelPrice({ price, unit, label, className }: { price: string; unit: number; label: string; className?: string }) {
  const still = globalThis.document?.documentElement?.dataset.reducedMotion === "true"
    || globalThis.window?.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
  const chars = [...price];
  let at = 0;
  return <span role="img" aria-label={label} data-pixel-price={price} className={cn("cloud-price flex shrink-0", className)} style={{ gap: GAP * unit }}>
    {chars.map((char, i) => {
      const here = at, key = String(chars.length - i);
      at += glyphOf(char)!.w + GAP;
      return <span key={DIGITS[char] ? `d${key}` : `m${key}${char}`} aria-hidden="true" className="block">
        {DIGITS[char] ? <Drum digit={Number(char)} at={here} unit={unit} still={still} /> : <Cut char={char} at={here} unit={unit} />}
      </span>;
    })}
  </span>;
}
