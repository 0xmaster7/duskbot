import { writeFileSync } from "node:fs";
import { C, opaquePng72, renderPixels, scene } from "../art/pixel-scene.mjs";

// dmg-builder (electron-builder 26.15.3) sets the Finder window frame to the background's size, title bar included,
// and Finder draws the background from the top of the content area. so the image is the frame: the top VISIBLE points
// are what people see, and the last BLEED points (the title bar's height, 28 to 32 pt by macOS version) sit under
// the window edge and stay empty canvas.
const W = 600;
const VISIBLE = 360;
const BLEED = 32;
const H = VISIBLE + BLEED;
// icon centres and size must match dmg.contents and dmg.iconSize in build/electron-builder.yml
const APP = { x: 160, y: 168 };
const APPLICATIONS = { x: 440, y: 168 };
const ICON = 112;

/** a standard install window: a flat light neutral, the two icons, one pixel arrow between them, nothing else */
export function plain() {
  const s = scene(W, H, { cell: 8, seed: 3 });
  s.rect(0, 0, W, H, "#f2f2f3");
  const u = 3;
  const from = APP.x + ICON / 2 + 30;
  const tip = APPLICATIONS.x - ICON / 2 - 30;
  const head = tip - 6 * u;
  s.rect(from, APP.y - u, head - from, 2 * u, C.ink);
  [12, 10, 8, 6, 4, 2].forEach((n, i) => s.rect(head + i * u, APP.y - (n * u) / 2, u, n * u, C.ink));
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
