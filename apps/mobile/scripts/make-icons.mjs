// Draws the phone app's icon and launch images from the brand vector (build/icon.svg), so the store builds never carry
// the template art a new Capacitor project starts with. Run after the brand vector changes: node apps/mobile/scripts/make-icons.mjs
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateSync } from "node:zlib";
import { Resvg } from "@resvg/resvg-js";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const brand = readFileSync(join(root, "build/icon.svg"), "utf8");
const gradient = /<linearGradient id="mascot-grey"[\s\S]*?<\/linearGradient>/.exec(brand)?.[0];
const body = /<path fill="url\(#mascot-grey\)"[\s\S]*?\/>/.exec(brand)?.[0];
if (!gradient || !body) throw new Error("build/icon.svg no longer has the mascot gradient and path this script reads");

const TILE = "#000000";
const LIGHT = "#fcfcfc";
const DARK = "#121212";

/** the mascot on its tile, drawn to the edges of a 1024 box; `radius` rounds the tile where nothing else will mask it */
const tile = (radius = 0) => `<defs>${gradient}<clipPath id="tile"><rect width="1024" height="1024" rx="${radius}"/></clipPath></defs>
  <g clip-path="url(#tile)"><rect width="1024" height="1024" fill="${TILE}"/>${body}</g>`;

function chunk(type, data) {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length);
  const named = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(named));
  return Buffer.concat([head, named, crc]);
}

/** App Store Connect refuses an icon with an alpha channel, and resvg always writes one: every image here covers its
 * whole canvas, so it is written as plain 8-bit RGB. */
function png(svg, size, rounded = false) {
  const image = new Resvg(svg, { fitTo: { mode: "width", value: size } }).render();
  // android's own launcher shapes are cut out of their square, so those keep their transparency
  if (rounded) return image.asPng();
  const { width, height, pixels } = image;
  const rows = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    for (let x = 0; x < width; x++) {
      const from = (y * width + x) * 4;
      if (pixels[from + 3] !== 255) throw new Error("an image left part of its canvas transparent");
      rows[row + 1 + x * 3] = pixels[from];
      rows[row + 2 + x * 3] = pixels[from + 1];
      rows[row + 3 + x * 3] = pixels[from + 2];
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(rows, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

function write(path, bytes) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
  console.log(path.slice(root.length));
}

/** ios masks the icon itself and refuses transparency, so the tile runs to every edge on an opaque ground */
const iosIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><rect width="1024" height="1024" fill="${TILE}"/>${tile()}</svg>`;

/** the launch image is a square the storyboard fills the screen with, so the mark sits small in the middle of the app's
 * own first-paint colour and survives the crop on every screen shape */
const splash = (ground) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2732 2732"><rect width="2732" height="2732" fill="${ground}"/>
  <g transform="translate(1206 1206) scale(0.3125)">${tile(230.4)}</g></svg>`;

const ios = join(root, "apps/mobile/ios/App/App/Assets.xcassets");
write(join(ios, "AppIcon.appiconset/AppIcon-512@2x.png"), png(iosIcon, 1024));
write(join(ios, "Splash.imageset/splash-light.png"), png(splash(LIGHT), 2732));
write(join(ios, "Splash.imageset/splash-dark.png"), png(splash(DARK), 2732));
writeFileSync(join(ios, "Splash.imageset/Contents.json"), `${JSON.stringify({
  images: [
    { idiom: "universal", filename: "splash-light.png", scale: "1x" },
    { idiom: "universal", filename: "splash-dark.png", scale: "1x", appearances: [{ appearance: "luminosity", value: "dark" }] },
  ],
  info: { version: 1, author: "xcode" },
}, null, 2)}\n`);

/** android: the legacy square and round icons, and the adaptive foreground (the mascot tile inside the 66% safe zone) */
const android = join(root, "apps/mobile/android/app/src/main/res");
const legacy = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">${tile(180)}</svg>`;
const round = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">${tile(512)}</svg>`;
const foreground = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><rect width="1024" height="1024" fill="${TILE}"/>
  <g transform="translate(174 174) scale(0.66)">${tile()}</g></svg>`;
/** android's launch images come in each screen shape; the mark is a fifth of the short side */
const launch = (width, height) => {
  const side = Math.min(width, height) / 5;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="${LIGHT}"/>
  <g transform="translate(${(width - side) / 2} ${(height - side) / 2}) scale(${side / 1024})">${tile(230.4)}</g></svg>`;
};
write(join(android, "drawable/splash.png"), png(launch(480, 320), 480));
for (const [density, size, short, long] of [["mdpi", 48, 320, 480], ["hdpi", 72, 480, 800], ["xhdpi", 96, 720, 1280], ["xxhdpi", 144, 960, 1600], ["xxxhdpi", 192, 1280, 1920]]) {
  write(join(android, `mipmap-${density}/ic_launcher.png`), png(legacy, size, true));
  write(join(android, `mipmap-${density}/ic_launcher_round.png`), png(round, size, true));
  write(join(android, `mipmap-${density}/ic_launcher_foreground.png`), png(foreground, Math.round(size * 2.25)));
  write(join(android, `drawable-port-${density}/splash.png`), png(launch(short, long), short));
  write(join(android, `drawable-land-${density}/splash.png`), png(launch(long, short), long));
}
