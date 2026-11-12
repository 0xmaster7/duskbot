import { writeFileSync } from "node:fs";
import { C, opaquePng72, renderPixels, scene } from "../art/pixel-scene.mjs";

// icon centres and size must match dmg.contents and dmg.iconSize in build/electron-builder.yml
const W = 660;
const H = 400;
const APP = { x: 170, y: 168 };
const APPLICATIONS = { x: 490, y: 168 };
const ICON = 112;

const DUSK = { sky0: "#2e2c86", sky1: "#4744e2", sky2: "#7a5ae8", sky3: "#b896f2", glow: "#ffc4dd", haze: "#ffe3ee" };

/** a soft rounded pixel blob: rows step in at the top and bottom corners */
function cloudPad(s, cx, cy, w, h, fill, step = 8) {
  puff(s, cx, cy, w, h, fill, step);
  puff(s, cx - w * 0.22, cy - h / 2 + step, w * 0.42, step * 6, fill, step);
  puff(s, cx + w * 0.16, cy - h / 2 - step, w * 0.5, step * 8, fill, step);
}

function puff(s, cx, cy, w, h, fill, step = 8) {
  const x = Math.round((cx - w / 2) / step) * step;
  const y = Math.round((cy - h / 2) / step) * step;
  const inset = [3, 1, 0];
  inset.forEach((n, i) => {
    s.rect(x + n * step, y + i * step, w - 2 * n * step, step, fill);
    s.rect(x + n * step, y + h - (i + 1) * step, w - 2 * n * step, step, fill);
  });
  s.rect(x, y + 3 * step, w, h - 6 * step, fill);
}

/** a dotted trail of squares from one icon to the other, ending in a stepped head */
function trail(s, fill, shadow) {
  const u = 6;
  const from = APP.x + ICON / 2 + 30;
  const tip = APPLICATIONS.x - ICON / 2 - 30;
  const head = tip - 4 * u;
  for (let x = from; x + 2 * u <= head - u; x += 3 * u) {
    if (shadow) s.rect(x + 2, APP.y - u / 2 + 2, 2 * u, u, shadow);
    s.rect(x, APP.y - u / 2, 2 * u, u, fill);
  }
  [7, 5, 3, 1].forEach((n, i) => {
    if (shadow) s.rect(head + i * u + 2, APP.y - (n * u) / 2 + 2, u, n * u, shadow);
    s.rect(head + i * u, APP.y - (n * u) / 2, u, n * u, fill);
  });
}

const DENSE = { fray: [0, 1, 1, 1, 2, 2, 3, 4], stray: 0.16 };

export const DMG_SCENES = {
  // the dusk.bot banner: bright sky over a pale horizon, the icons on the calm band, friends floating up top
  meadow() {
    const s = scene(W, H, { cell: 8, seed: 41 });
    s.sky([[C.sky0, 0], [C.sky1, 4], [C.sky2, 11], [C.sky3, 15], [C.canvas, 19]], DENSE);
    s.cloud(110, 3, 12, C.pink);
    s.ground(37, { flowers: 6, speckle: 0.05 });
    s.hill(W / 2, 37, 14, 2);
    s.bot("pip", C.blue, W / 2, 37 * 8 - 16, 3);
    s.bot("hoot", C.violet, 470, 54, 2.5).bot("mochi", C.pinkBot, 520, 46, 2.5).bot("loaf", C.tangerine, 570, 54, 2.5);
    trail(s, C.sky1);
    return s.svg();
  },
  // every icon on its own white cloud, a bridge of cloud puffs between them, one bot halfway across
  bridge() {
    const s = scene(W, H, { cell: 8, seed: 7 });
    s.sky([[C.sky0, 0], [C.sky1, 6], [C.sky2, 20], [C.sky3, 34], [C.canvas, 40]], DENSE);
    s.ground(46, { flowers: 4, speckle: 0.05 });
    for (const icon of [APP, APPLICATIONS]) {
      cloudPad(s, icon.x + 4, icon.y + 34, 216, 152, C.pink);
      cloudPad(s, icon.x, icon.y + 30, 216, 152, C.cloud);
    }
    trail(s, C.cloud, C.pink);
    s.bot("pip", C.blue, W / 2 - 20, APP.y - 3, 2.5);
    s.bot("mochi", C.pinkBot, 64, 46 * 8 - 8, 2.5).bot("hoot", C.violet, 600, 46 * 8 - 8, 2.5, { flip: true });
    s.cloud(W / 2, 3, 10, C.lemon);
    return s.svg();
  },
  // the hour the app is named for: an indigo sky warming to a pink glow, the icons on the glow, stars overhead
  dusk() {
    const s = scene(W, H, { cell: 8, seed: 23 });
    s.sky([[DUSK.sky0, 0], [DUSK.sky1, 4], [DUSK.sky2, 7], [DUSK.sky3, 10], [DUSK.glow, 12], [DUSK.haze, 14]], DENSE);
    for (let i = 0; i < 26; i++) {
      const x = Math.floor(s.rand() * (W / 4)) * 4;
      const y = Math.floor(s.rand() * 10) * 4;
      s.rect(x, y, 4, 4, s.rand() < 0.3 ? C.lemon : C.cloud);
    }
    s.cloud(120, 3, 10, C.lilac);
    s.ground(34, { flowers: 6, speckle: 0.05 });
    s.raw(`<rect x="0" y="${34 * 8}" width="${W}" height="${H - 34 * 8}" fill="#7fb51c" opacity="0.25"/>`);
    s.hill(W / 2, 34, 14, 2);
    s.bot("kit", C.cloud, W / 2, 34 * 8 - 16, 3, { eyes: "#212121" });
    s.bot("hoot", C.violet, 560, 44, 2.5).bot("mochi", C.pinkBot, 606, 36, 2.5);
    trail(s, DUSK.sky2);
    return s.svg();
  },
};
/** a plain canvas: the two icons, a slim ink arrow, and a few bots peeking up from the bottom edge */
function mascots(line) {
  const s = scene(W, H, { cell: 8, seed: 3 });
  s.rect(0, 0, W, H, "#ffffff");
  const u = 3;
  const from = APP.x + ICON / 2 + 34;
  const tip = APPLICATIONS.x - ICON / 2 - 34;
  const head = tip - 6 * u;
  s.rect(from, APP.y - u, head - from, 2 * u, C.ink);
  [12, 10, 8, 6, 4, 2].forEach((n, i) => s.rect(head + i * u, APP.y - (n * u) / 2, u, n * u, C.ink));
  // floors below the window edge, so each bot shows only from the eyes up
  s.bot("mochi", C.pinkBot, 222, H + 2 * 4, 4);
  s.bot("kit", C.violet, W / 2, H + 3 * 6, 6);
  s.bot("pip", C.blue, 438, H + 4 * 4, 4);
  s.bot("loaf", C.tangerine, 110, H + 3 * 3, 3).bot("goo", C.mint, 552, H + 3 * 3, 3);
  if (line) s.text(W / 2, 282, line, { size: 17, anchor: "middle" });
  return s.svg();
}
DMG_SCENES.mascots = () => mascots(null);
DMG_SCENES.mascotsText = () => mascots("drag dusk bot to Applications");

export const DEFAULT_DMG_SCENE = "mascotsText";

const svg = DMG_SCENES[DEFAULT_DMG_SCENE]();
for (const [scale, name] of [
  [1, "background.png"],
  [2, "background@2x.png"],
]) {
  const png = opaquePng72(renderPixels(svg, scale));
  writeFileSync(new URL(`../${name}`, import.meta.url), png);
  console.log(`build/${name}: ${W * scale}x${H * scale}, ${png.length} bytes`);
}
// --options <dir> writes every scene's @2x background there, for choosing between them
if (process.argv.includes("--options")) {
  const dir = process.argv[process.argv.indexOf("--options") + 1];
  for (const name of Object.keys(DMG_SCENES)) writeFileSync(`${dir}/${name}@2x.png`, opaquePng72(renderPixels(DMG_SCENES[name](), 2)));
}
