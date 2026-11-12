import { cn } from "@/lib/cn";

/* dusk's small pixel icons: 11 by 11 cells drawn at 2px, one outline that follows the text colour and a few fixed fills.
   Each row is a string; a cell is "." (empty), "o" (outline) or a fill letter from FILLS. */
const FILLS: Record<string, string> = { w: "#fafbfc", b: "#4a8fd0", B: "#9fd3f5", g: "#6cc58a", y: "#f2c94c", p: "#f29bb5", v: "#a78bfa", V: "#cdbefc", G: "#c7cfd9", r: "#f2994a", n: "#deaa6e", N: "#c48c50", K: "#8e9aab" };

const ICONS = {
  palette: [
    "...ooooo...",
    "..onnnnno..",
    ".onrnnnbno.",
    "onnnnnnnnno",
    "ongnnnnnyno",
    "onnnnoonnno",
    "onvno..ono.",
    ".onno..oo..",
    ".onnnoooo..",
    "..oonnnnno.",
    "....ooooo..",
  ],
  droplet: [
    ".....o.....",
    "....obo....",
    "....obo....",
    "...obbbo...",
    "..obbbbbo..",
    ".obBbbbbbo.",
    ".obBbbbbbo.",
    ".obbBbbbbo.",
    ".obbbbbbbo.",
    "..obbbbbo..",
    "...ooooo...",
  ],
  bubble: [
    "...........",
    ".ooooooooo.",
    "oBBBBBBBBBo",
    "oBBBBBBBBBo",
    "oBBbBBbBBbo",
    "oBBBBBBBBBo",
    "oBBBBBBBBBo",
    ".ooBooooooo",
    "..oBo......",
    "..oo.......",
    "...........",
  ],
  globe: [
    "...ooooo...",
    "..obggbbbo.",
    ".obgggbbbbo",
    "obbggbbbgbo",
    "obbbgbbggbo",
    "obbbbbbggbo",
    "obbbggbbbbo",
    "obbgggbbbbo",
    ".obbggbbbo.",
    "..obbbbbo..",
    "...ooooo...",
  ],
  keyboard: [
    "...........",
    "...........",
    "ooooooooooo",
    "owKwKwKwKwo",
    "owwwwwwwwwo",
    "oKwKwKwKwKo",
    "owwwwwwwwwo",
    "owwKKKKKwwo",
    "owwwwwwwwwo",
    "ooooooooooo",
    "...........",
  ],
  bolt: [
    ".....oooo..",
    "....oyyyo..",
    "...oyyyo...",
    "..oyyyo....",
    ".oyyyyyyyo.",
    ".oooooyyo..",
    "....oyyo...",
    "...oyyo....",
    "..oyyo.....",
    "..oyo......",
    "..oo.......",
  ],
  bell: [
    ".....o.....",
    "....oyo....",
    "...oyyyo...",
    "..oyyyyyo..",
    "..oywyyyo..",
    "..oywyyyo..",
    ".oyyyyyyyo.",
    "oyyyyyyyyyo",
    "ooooooooooo",
    "....oro....",
    ".....o.....",
  ],
  speaker: [
    "...........",
    "....o...o..",
    "...oo....o.",
    "oooGo..o..o",
    "oGGGo...o.o",
    "oGGGo...o.o",
    "oGGGo...o.o",
    "oooGo..o..o",
    "...oo....o.",
    "....o...o..",
    "...........",
  ],
  clock: [
    "...ooooo...",
    "..owwwwwo..",
    ".owwwowwwo.",
    "owwwwowwwwo",
    "owwwwowwwwo",
    "owwwwoooowo",
    "owwwwwwwwwo",
    "owwwwwwwwwo",
    ".owwwwwwwo.",
    "..owwwwwo..",
    "...ooooo...",
  ],
  mic: [
    "....ooo....",
    "...opppo...",
    "...opwpo...",
    "...opwpo...",
    "...opppo...",
    ".o.opppo.o.",
    ".o..ooo..o.",
    "..o.....o..",
    "...ooooo...",
    ".....o.....",
    "...ooooo...",
  ],
  parcel: [
    "...........",
    ".ooooooooo.",
    "oNNNNoNNNNo",
    "ooooooooooo",
    "onnnnonnnno",
    "onnnnonnnno",
    "onnnwwwnnno",
    "onnnwwwnnno",
    "onnnnnnnnno",
    "ooooooooooo",
    "...........",
  ],
  laptop: [
    "...........",
    ".ooooooooo.",
    ".obBbbbbbo.",
    ".oBbbbbbbo.",
    ".obbbbbbbo.",
    ".obbbbbbbo.",
    ".ooooooooo.",
    "oGGGGGGGGGo",
    "ooooooooooo",
    "...........",
    "...........",
  ],
  server: [
    ".ooooooooo.",
    ".oGGGGGGgo.",
    ".oGGGGGGGo.",
    ".ooooooooo.",
    ".oGGGGGGgo.",
    ".oGGGGGGGo.",
    ".ooooooooo.",
    ".oGGGGGGgo.",
    ".oGGGGGGGo.",
    ".ooooooooo.",
    "...........",
  ],
  cloud: [
    "...........",
    "...........",
    "....ooo....",
    "...owwwo...",
    ".oowwwwwoo.",
    "owwwwwwwwwo",
    "owwwwwwwwwo",
    "oBBwwwwwBBo",
    ".ooooooooo.",
    "...........",
    "...........",
  ],
  team: [
    "...........",
    "..oo...oo..",
    ".oppo.ovvo.",
    ".oppo.ovvo.",
    "..oo...oo..",
    ".oooo.oooo.",
    "oppppovvvvo",
    "oppppovvvvo",
    "ooooooooooo",
    "...........",
    "...........",
  ],
  note: [
    "..ooooooo..",
    "..owwwwwo..",
    "..owGGGwo..",
    "..owwwwwo..",
    "..owGGGwo..",
    "..owwwwwo..",
    "..owGGwwo..",
    "..owwwwwo..",
    "..ooooooo..",
    "...........",
    "...........",
  ],
  bookmark: [
    "..ooooooo..",
    "..ovvvvvo..",
    "..ovVvvvo..",
    "..ovvvvvo..",
    "..ovvvvvo..",
    "..ovvvvvo..",
    "..ovvovvo..",
    "..ovo.ovo..",
    "..oo...oo..",
    "...........",
    "...........",
  ],
  sparkle: [
    ".....o.....",
    "....oyo....",
    "....oyo....",
    "..ooyyyoo..",
    ".oyyywyyyo.",
    "..ooyyyoo..",
    "....oyo....",
    "....oyo....",
    ".....o.....",
    "...........",
    "...........",
  ],
  plus: [
    "...........",
    "....ooo....",
    "....ogo....",
    "....ogo....",
    ".oooogoooo.",
    ".oggggggo..",
    ".oooogoooo.",
    "....ogo....",
    "....ogo....",
    "....ooo....",
    "...........",
  ],
} as const;

export type PixelIconName = keyof typeof ICONS;

/** one rect per run of a colour along a row, so an icon is a handful of rects */
function runs(rows: readonly string[]) {
  const out: { x: number; y: number; w: number; c: string }[] = [];
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const c = row[x]!;
      let end = x + 1;
      while (end < row.length && row[end] === c) end += 1;
      if (c !== ".") out.push({ x, y, w: end - x, c });
      x = end;
    }
  });
  return out;
}

const DRAWN = Object.fromEntries(Object.entries(ICONS).map(([name, rows]) => [name, runs(rows)])) as Record<PixelIconName, ReturnType<typeof runs>>;

export function PixelIcon({ name, size = 22, className }: { name: PixelIconName; size?: number; className?: string }) {
  return (
    <svg aria-hidden="true" data-pixel-icon={name} width={size} height={size} viewBox="0 0 11 11" shapeRendering="crispEdges"
      className={cn("shrink-0 text-ink/75", className)}>
      {DRAWN[name].map((run) => <rect key={`${run.x}-${run.y}`} x={run.x} y={run.y} width={run.w} height={1} fill={run.c === "o" ? "currentColor" : FILLS[run.c]} />)}
    </svg>
  );
}
