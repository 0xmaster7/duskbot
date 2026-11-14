import { writeFileSync } from "node:fs";
import { C, opaquePng72, renderPixels, scene } from "../art/pixel-scene.mjs";

// dmg-builder (electron-builder 26.15.3) sets the Finder window frame to the background's size, title bar included,
// and Finder draws the background from the top of the content area. so the image is the frame: the top VISIBLE points
// are what people see, and the last BLEED points (the title bar's height, 28 to 32 pt by macOS version) sit under
// the window edge and stay empty canvas.
const W = 660;
const VISIBLE = 400;
const BLEED = 32;
const H = VISIBLE + BLEED;
// icon centres and size must match dmg.contents and dmg.iconSize in build/electron-builder.yml
const APP = { x: 170, y: 168 };
const APPLICATIONS = { x: 490, y: 168 };
const ICON = 112;

/** a plain canvas: the two icons, a slim ink arrow between them, and a few bots standing along the bottom */
export function plain() {
  const s = scene(W, H, { cell: 8, seed: 3 });
  s.rect(0, 0, W, H, "#ffffff");
  const u = 3;
  const from = APP.x + ICON / 2 + 34;
  const tip = APPLICATIONS.x - ICON / 2 - 34;
  const head = tip - 6 * u;
  s.rect(from, APP.y - u, head - from, 2 * u, C.ink);
  [12, 10, 8, 6, 4, 2].forEach((n, i) => s.rect(head + i * u, APP.y - (n * u) / 2, u, n * u, C.ink));
  // whole bots, every floor well above the visible bottom edge
  const floor = VISIBLE - 14;
  s.bot("loaf", C.tangerine, 110, floor, 3).bot("goo", C.mint, 552, floor, 3);
  s.bot("mochi", C.pinkBot, 222, floor, 4);
  s.bot("pip", C.blue, 438, floor, 4);
  s.bot("kit", C.violet, W / 2, floor, 5);
  return s.svg();
}

const svg = plain();
for (const [scale, name] of [
  [1, "background.png"],
  [2, "background@2x.png"],
]) {
  const png = opaquePng72(renderPixels(svg, scale));
  writeFileSync(new URL(`../${name}`, import.meta.url), png);
  console.log(`build/${name}: ${W * scale}x${H * scale} (top ${VISIBLE * scale} visible), ${png.length} bytes`);
}
