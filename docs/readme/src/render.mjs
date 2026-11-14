// renders the README images from the pages in this folder, using the landing's own css, fonts and art.
//   node docs/readme/src/render.mjs            every image, light and dark
//   node docs/readme/src/render.mjs header hero only these
// needs playwright with chromium. it is not a repo dependency: install it anywhere and point at it with
//   PLAYWRIGHT_DIR=/path/to/node_modules node docs/readme/src/render.mjs
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const landing = fileURLToPath(new URL("../../../apps/site/public/landing/", import.meta.url));
const out = fileURLToPath(new URL("../", import.meta.url));

// name: [page, width in css px, themes, { scale, quality }]
const IMAGES = {
  header: ["header.html", 1040, ["light", "dark"], { scale: 3, quality: 0.96 }],
  hint: ["hint.html", 1040, ["light", "dark"]],
  "btn-mac": ["button.html?os=mac", 0, ["light", "dark"]],
  "btn-windows": ["button.html?os=windows", 0, ["light", "dark"]],
  "btn-linux": ["button.html?os=linux", 0, ["light", "dark"]],
  "btn-site": ["button.html?os=site", 0, ["light", "dark"]],
  hero: ["hero.html", 1040, ["light", "dark"]],
  say: ["section.html?s=.say", 1040, ["light", "dark"]],
  many: ["section.html?s=.many", 1040, ["light", "dark"]],
  routines: ["routines.html", 1040, ["light", "dark"]],
  computer: ["computer.html", 1040, ["light", "dark"]],
  where: ["section.html?s=.where", 1240, ["light", "dark"]],
  ai: ["section.html?s=.byo", 1040, ["light", "dark"]],
  tools: ["tools.html", 1040, ["light", "dark"]],
  phone: ["phone.html", 1040, ["light", "dark"]],
  free: ["section.html?s=.free", 1040, ["light", "dark"]],
  how: ["section.html?s=.how", 1040, ["light", "dark"]],
  link: ["link.html", 1040, ["light", "dark"]],
};

const TYPES = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".mjs": "text/javascript", ".svg": "image/svg+xml",
  ".png": "image/png", ".webp": "image/webp", ".jpg": "image/jpeg", ".woff2": "font/woff2", ".json": "application/json" };

const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const [root, rest] = path.startsWith("/readme/") ? [here, path.slice(8)] : [landing, path.slice(1) || "index.html"];
  const file = normalize(join(root, rest));
  if (!file.startsWith(root)) return void res.writeHead(403).end();
  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" }).end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;

const require = createRequire(process.env.PLAYWRIGHT_DIR ? join(process.env.PLAYWRIGHT_DIR, "x.js") : import.meta.url);
const { chromium } = require("playwright");
const browser = await chromium.launch({ args: ["--use-mock-keychain", "--password-store=basic"] });
const wanted = process.argv.slice(2);
try {
  for (const [name, [page, width, themes, { scale = 2, quality = 0.9 } = {}]] of Object.entries(IMAGES)) {
    if (wanted.length && !wanted.includes(name)) continue;
    for (const theme of themes) {
      const context = await browser.newContext({ viewport: { width: width || 1040, height: 900 }, deviceScaleFactor: scale, colorScheme: theme });
      const tab = await context.newPage();
      tab.on("pageerror", (error) => console.error(`${name} ${theme}:`, error.message));
      await tab.goto(`${base}/readme/${page}${page.includes("?") ? "&" : "?"}theme=${theme}`);
      await tab.waitForSelector("body[data-ready]", { timeout: 20_000 });
      const png = await tab.locator("#shot").screenshot({ omitBackground: true });
      // chromium encodes the webp, so nothing else needs installing
      const webp = await tab.evaluate(async ([data, q]) => {
        const img = new Image();
        img.src = `data:image/png;base64,${data}`;
        await img.decode();
        const canvas = Object.assign(document.createElement("canvas"), { width: img.width, height: img.height });
        canvas.getContext("2d").drawImage(img, 0, 0);
        return canvas.toDataURL("image/webp", q).split(",")[1];
      }, [png.toString("base64"), quality]);
      await writeFile(join(out, `${name}-${theme}.webp`), Buffer.from(webp, "base64"));
      console.log(`${name}-${theme}.webp`);
      await context.close();
    }
  }
} finally {
  await browser.close();
  server.close();
}
