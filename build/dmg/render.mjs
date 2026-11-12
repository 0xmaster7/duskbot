import { writeFileSync } from "node:fs";
import { C, opaquePng72, renderPixels, scene } from "../art/pixel-scene.mjs";

// icon centres and size must match dmg.contents and dmg.iconSize in build/electron-builder.yml
const W = 660;
const H = 400;
const APP = { x: 170, y: 168 };
const APPLICATIONS = { x: 490, y: 168 };
const ICON = 112;

export function dmgScene() {
  const s = scene(W, H, { cell: 8, seed: 41 });
  // one soft sky, lightest where the icons sit so the app icon and both labels stand out
  s.sky([
    ["#f7fbfe", 0],
    [C.canvas, 32],
    ["#dcf3fd", 40],
    [C.sky3, 45],
  ], { fray: [0, 0, 0, 1], stray: 0 });

  // a quiet pixel cloud line along the bottom edge
  for (let x = 0; x < W;) {
    const run = 2 + Math.floor(s.rand() * 4);
    const rise = [1, 1, 2, 2, 3][Math.floor(s.rand() * 5)];
    s.rect(x, H - (2 + rise) * 8, run * 8, (2 + rise) * 8, C.cloud);
    x += run * 8;
  }

  // one arrow between the icons: a slim ink shaft and a stepped head
  const u = 3;
  const from = APP.x + ICON / 2 + 34;
  const tip = APPLICATIONS.x - ICON / 2 - 34;
  const head = tip - 6 * u;
  s.rect(from, APP.y - u, head - from, 2 * u, C.ink);
  [12, 10, 8, 6, 4, 2].forEach((n, i) => s.rect(head + i * u, APP.y - (n * u) / 2, u, n * u, C.ink));

  s.text(W / 2, 292, "drag dusk bot to Applications", { size: 20, anchor: "middle" });
  s.bot("pip", C.blue, W - 36, H - 24, 2);
  return s.svg();
}

const svg = dmgScene();
for (const [scale, name] of [
  [1, "background.png"],
  [2, "background@2x.png"],
]) {
  const png = opaquePng72(renderPixels(svg, scale));
  writeFileSync(new URL(`../${name}`, import.meta.url), png);
  console.log(`build/${name}: ${W * scale}x${H * scale}, ${png.length} bytes`);
}
if (process.argv.includes("--svg")) writeFileSync(process.argv[process.argv.indexOf("--svg") + 1], svg);
