import { writeFileSync } from "node:fs";
import { C, opaquePng72, renderPixels, scene } from "../art/pixel-scene.mjs";

// dmg-builder (electron-builder 26.15.3) sets the Finder window frame to the background's size, title bar included,
// and Finder draws the background from the top of the content area. so the image is the frame: the top VISIBLE points
// are what people see, and the last BLEED points (the title bar's height, 28 to 32 pt by macOS version) sit under
// the window edge and only ever carry plain meadow.
const W = 660;
const VISIBLE = 400;
const BLEED = 32;
const H = VISIBLE + BLEED;
// icon centres and size must match dmg.contents and dmg.iconSize in build/electron-builder.yml
const APP = { x: 170, y: 140 };
const APPLICATIONS = { x: 490, y: 140 };
const ICON = 112;

// dusk: violet up top, a mid lilac band behind the icons, warming to peach at the horizon.
// the band holds relative luminance near 0.18, so Finder's label text, black in light mode and white in dark mode,
// reads at about 4.5:1 either way.
const SKY = {
  top: "#3f3790", high: "#5a4cab", band: "#7d68c4", mauve: "#a782c8", rose: "#e39cb4", peach: "#ffc39c",
  hillFar: "#c3b2ee", hillNear: "#a28fe0", sun: "#ffe7a8", sunRim: "#ffd18c", trail: "#ffd9b8", trailShade: "#5a4cab",
};
const ROW = { high: 8, band: 18, mauve: 32, rose: 35, peach: 37, ground: 41 };

/** a stepped pixel disc, cut flat at `clip` (the horizon) */
function sun(s, cx, cy, radius, clip) {
  const u = 4;
  for (let y = cy - radius; y < Math.min(cy + radius, clip); y += u) {
    const dy = y + u / 2 - cy;
    const half = Math.floor(Math.sqrt(radius * radius - dy * dy) / u) * u;
    if (half <= 0) continue;
    s.rect(cx - half, y, 2 * half, u, SKY.sunRim);
    if (half > u) s.rect(cx - half + u, y, 2 * half - 2 * u, u, SKY.sun);
  }
}

/** a soft run of stepped hills along the horizon: [centre x, width in cells, height in cells] */
function hills(s, list, fill, baseRow) {
  const cell = s.cell;
  for (const [cx, w, h] of list) {
    for (let i = 0; i < h; i++) {
      const ww = w - i * 3;
      if (ww <= 0) break;
      const x = Math.round(cx / cell - ww / 2) * cell;
      s.rect(x, (baseRow - i - 1) * cell, ww * cell, cell, fill);
    }
  }
}

/** a dashed trail from one icon to the other at icon height, ending in a stepped arrowhead, with a one-unit shadow */
function trail(s) {
  const u = 4;
  const y = APP.y;
  const from = APP.x + ICON / 2 + 30;
  const tip = APPLICATIONS.x - ICON / 2 - 26;
  const head = tip - 5 * u;
  const dash = (x, yy, w, h) => {
    s.rect(x + u, yy + u, w, h, SKY.trailShade);
    s.rect(x, yy, w, h, SKY.trail);
  };
  for (let x = from; x + 4 * u <= head - 2 * u; x += 6 * u) dash(x, y - u, 4 * u, 2 * u);
  [9, 7, 5, 3, 1].forEach((n, i) => dash(head + i * u, y - (n * u) / 2, u, n * u));
}

export function dusk() {
  const s = scene(W, H, { cell: 8, seed: 19 });
  s.sky(
    [[SKY.top, 0], [SKY.high, ROW.high], [SKY.band, ROW.band], [SKY.mauve, ROW.mauve], [SKY.rose, ROW.rose], [SKY.peach, ROW.peach]],
    // no stray cells: anything loose would land under the icon labels
    { fray: [0, 1, 1, 1, 2, 2], stray: 0 },
  );
  // a few stars in the dark part of the sky, clear of the icons and the trail
  const keep = (x, y) => Math.abs(y - APP.y) > 70 || (x > APP.x + 76 && x < APPLICATIONS.x - 76 && Math.abs(y - APP.y) > 20);
  for (let n = 0; n < 40; n++) {
    const x = Math.floor(s.rand() * (W / 4)) * 4;
    const y = Math.floor(s.rand() * 16) * 4 + 8;
    if (!keep(x, y)) continue;
    s.rect(x, y, 4, 4, s.rand() < 0.3 ? C.lemon : "#e9e2ff");
  }
  s.cloud(96, 3, 9, SKY.mauve);
  s.cloud(586, 9, 6, SKY.mauve);
  sun(s, W / 2, ROW.ground * 8 - 4, 60, ROW.ground * 8);
  hills(s, [[56, 30, 6], [226, 14, 3], [434, 14, 3], [620, 26, 5]], SKY.hillFar, ROW.ground);
  hills(s, [[150, 22, 3], [520, 20, 3]], SKY.hillNear, ROW.ground);
  s.ground(ROW.ground + 1, { flowers: 9, speckle: 0.05, avoid: [[0, VISIBLE - 8, W, H]] });
  trail(s);
  // friends on the meadow, every one standing well inside the visible area
  const floor = VISIBLE - 16;
  s.bot("mochi", C.pinkBot, 74, floor - 2, 2.5);
  s.bot("loaf", C.tangerine, 196, floor + 2, 2.5);
  s.bot("kit", C.cloud, W / 2, floor, 3.5, { eyes: C.ink });
  s.bot("pip", C.blue, 462, floor + 2, 2.5);
  s.bot("hoot", C.violet, 590, floor - 2, 2.5, { flip: true });
  return s.svg();
}

const svg = dusk();
for (const [scale, name] of [
  [1, "background.png"],
  [2, "background@2x.png"],
]) {
  const png = opaquePng72(renderPixels(svg, scale));
  writeFileSync(new URL(`../${name}`, import.meta.url), png);
  console.log(`build/${name}: ${W * scale}x${H * scale} (top ${VISIBLE * scale} visible), ${png.length} bytes`);
}
