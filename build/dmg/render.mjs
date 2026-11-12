import { writeFileSync } from "node:fs";
import { C, opaquePng72, renderPixels, scene } from "../art/pixel-scene.mjs";

// icon centres and size must match dmg.contents and dmg.iconSize in build/electron-builder.yml
const W = 720;
const H = 440;
const APP = { x: 180, y: 206 };
const APPLICATIONS = { x: 540, y: 206 };
const ICON = 112;

export function dmgScene() {
  const s = scene(W, H, { cell: 8, seed: 41 });
  s.sky([
    [C.sky0, 0],
    [C.sky1, 5],
    [C.sky2, 13],
    [C.sky3, 31],
    [C.canvas, 34],
  ]);
  s.cloud(96, 3, 14, C.pink);
  s.cloud(636, 6, 10, C.lemon);
  s.ground(41, { flowers: 7, avoid: [[180, 360, 360, 50]] });

  // the way across: a dashed trail of white blocks with a pink shadow, ending in a stepped arrowhead
  const u = 8;
  const mid = APP.y;
  const from = APP.x + ICON / 2 + 36;
  const head = APPLICATIONS.x - ICON / 2 - 36 - 4 * u;
  for (let x = from; x + 2 * u <= head - u; x += 3 * u) {
    s.rect(x + 2, mid - u / 2 + 3, 2 * u, u, C.pink).rect(x, mid - u / 2, 2 * u, u, C.cloud);
  }
  [7, 5, 3, 1].forEach((n, i) => s.rect(head + i * u + 2, mid - (n * u) / 2 + 3, u, n * u, C.pink));
  [7, 5, 3, 1].forEach((n, i) => s.rect(head + i * u, mid - (n * u) / 2, u, n * u, C.cloud));

  // a blue bot hopping along the trail, saying where to go
  const botX = from + 3 * u;
  s.bot("pip", C.blue, botX, mid - u / 2, 3);
  s.bubble(botX + 4, mid - 56, "this way!", { size: 17, pad: 12, tail: "left" });

  // friends on the horizon, clear of both icons and their labels
  s.bot("mochi", C.pinkBot, 54, 328, 3);
  s.bot("loaf", C.tangerine, 92, 328, 2.5);
  s.bot("hoot", C.violet, 660, 328, 3, { flip: true });

  s.text(W / 2, 384, "drag dusk bot into Applications", { size: 22, anchor: "middle" });
  s.text(W / 2, 410, "then open it from there, it will say hi", { size: 14, fill: C.inkSoft, anchor: "middle" });
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
