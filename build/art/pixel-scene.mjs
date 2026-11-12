// pixel sky scenes for the surfaces people meet outside the app window: the install window, installer pages,
// the phone splash, share cards. one cell grid, flat brand colours, the bots drawn by the app's own pixel engine.
import { readFileSync } from "node:fs";
import { crc32, deflateSync } from "node:zlib";
import { Resvg } from "@resvg/resvg-js";
import { stillSvgPaths } from "../../src/pixel/core.ts";

export const C = {
  sky0: "#06bafd", sky1: "#3cd0fd", sky2: "#90e4fc", sky3: "#c2ecfc", canvas: "#eaf6fd",
  lilac: "#d0cefb", lime: "#c9f63f", limeDeep: "#bde834", pink: "#ffc4dd", lemon: "#fff3a0",
  cloud: "#fdfdfd", ink: "#1b1b1f", inkSoft: "#3a3a44",
  blue: "#286ef9", pinkBot: "#f12b93", violet: "#894ef0", tangerine: "#fb7c01", mint: "#26cb96",
  sun: "#e5a915", indigo: "#4744e2", coral: "#f75e51", emerald: "#10a760", cyan: "#1cb7d8", limeBot: "#7ac70f",
};

const FONT_DIR = new URL("fonts/", import.meta.url);
const METRICS = JSON.parse(readFileSync(new URL("metrics.json", FONT_DIR), "utf8"));
export const FONT_FILES = ["general-sans-medium.ttf", "general-sans-semibold.ttf"].map((f) => new URL(f, FONT_DIR).pathname);
const FAMILY = { medium: "General Sans Medium", semibold: "General Sans Semibold" };

export function textWidth(s, size, weight = "semibold") {
  const m = METRICS[weight];
  let w = 0;
  for (const ch of s) w += m[ch] ?? 0.55;
  return w * size;
}

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const r = (x, y, w, h, fill) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`;

/** A W by H point canvas drawn on a grid of `cell` point squares. */
export function scene(W, H, { cell = 8, seed = 7 } = {}) {
  const out = [];
  const rand = rng(seed);
  const cols = Math.ceil(W / cell);
  const pick = (list) => list[Math.floor(rand() * list.length)];

  const api = {
    W, H, cell, rand,
    raw(s) { out.push(s); return api; },
    rect(x, y, w, h, fill) { out.push(r(x, y, w, h, fill)); return api; },

    /** stacked sky bands, each [colour, top row]; every lighter band frays up into the one above in chunky steps */
    sky(bands, { fray = [0, 0, 1, 1, 1, 2, 2, 3], stray = 0.07 } = {}) {
      bands.forEach(([fill, row], i) => {
        const next = bands[i + 1];
        out.push(r(0, row * cell, W, (next ? next[1] - row : Math.ceil(H / cell) - row) * cell, fill));
      });
      for (let i = 1; i < bands.length; i++) {
        const [fill, row] = bands[i];
        let x = 0;
        while (x < cols) {
          const run = 1 + Math.floor(rand() * 3);
          const h = pick(fray);
          if (h) out.push(r(x * cell, (row - h) * cell, run * cell, h * cell, fill));
          if (rand() < stray) out.push(r((x + Math.floor(rand() * run)) * cell, (row - h - 2 - Math.floor(rand() * 2)) * cell, cell, cell, fill));
          x += run;
        }
      }
      return api;
    },

    /** a flat pixel cloud: stepped white top, a coloured underside one cell wider each side */
    cloud(cx, row, w, under = C.pink) {
      const x = Math.round(cx / cell - w / 2) * cell;
      const y = row * cell;
      out.push(r(x + 2 * cell, y, (w - 4) * cell, cell, C.cloud));
      out.push(r(x, y + cell, w * cell, 2 * cell, C.cloud));
      out.push(r(x - cell, y + 3 * cell, (w + 2) * cell, cell, under));
      out.push(r(x + cell, y + 4 * cell, (w - 2) * cell, cell, under));
      return api;
    },

    /** ground from `row` down: a lilac horizon line, lime, a few deeper lime cells and tiny flowers */
    ground(row, { speckle = 0.05, flowers = 6, avoid = [] } = {}) {
      const y = row * cell;
      out.push(r(0, y - cell, W, cell, C.lilac));
      out.push(r(0, y, W, H - y, C.lime));
      const rows = Math.ceil((H - y) / cell);
      for (let j = 1; j < rows; j++) for (let i = 0; i < cols; i++) if (rand() < speckle) out.push(r(i * cell, y + j * cell, cell * (rand() < 0.3 ? 2 : 1), cell, C.limeDeep));
      for (let n = 0; n < flowers; n++) {
        const fx = Math.floor(rand() * cols) * cell + cell / 2;
        const fy = y + (1 + Math.floor(rand() * Math.max(1, rows - 2))) * cell + cell / 2;
        if (avoid.some(([ax, ay, aw, ah]) => fx > ax && fx < ax + aw && fy > ay && fy < ay + ah)) continue;
        api.flower(fx, fy, pick([C.cloud, C.pink, C.lemon]));
      }
      return api;
    },

    /** a stepped mound sitting on the ground line, lilac rim on top like the horizon */
    hill(cx, row, w, steps = 3) {
      for (let s = 0; s < steps; s++) {
        const ww = w - s * 4;
        const x = Math.round(cx / cell - ww / 2) * cell;
        const y = (row - s - 1) * cell;
        out.push(r(x, y - cell, ww * cell, cell, C.lilac));
        out.push(r(x, y, ww * cell, (s + 1) * cell, C.lime));
      }
      return api;
    },

    flower(x, y, fill = C.cloud, p = cell / 3) {
      out.push(r(x - p / 2, y - p * 1.5, p, p * 3, fill), r(x - p * 1.5, y - p / 2, p * 3, p, fill), r(x - p / 2, y - p / 2, p, p, C.lemon));
      return api;
    },

    /** one of the app's pixel bots, standing with its floor at (x, floor); `px` points per sprite pixel; eyes are white */
    bot(body, fill, x, floor, px = cell / 2, { eyes = C.cloud, flip = false } = {}) {
      const s = stillSvgPaths(body, { scale: 1 });
      const tx = x - (s.G * px) / 2;
      const ty = floor - s.G * px;
      const m = flip ? `translate(${tx + s.G * px} ${ty}) scale(${-px} ${px})` : `translate(${tx} ${ty}) scale(${px})`;
      out.push(`<g transform="${m}" shape-rendering="crispEdges"><path d="${s.body}" fill="${fill}"/><path d="${s.eyes}" fill="${eyes}"/></g>`);
      return api;
    },

    text(x, y, s, { size = 16, weight = "semibold", fill = C.ink, anchor = "start", spacing = 0 } = {}) {
      out.push(`<text x="${x}" y="${y}" font-family="${FAMILY[weight]}" font-size="${size}" fill="${fill}" text-anchor="${anchor}"${spacing ? ` letter-spacing="${spacing}"` : ""}>${esc(s)}</text>`);
      return api;
    },

    /** the email speech bubble: white, square-stepped corners, a pink shadow underneath, a stepped tail.
     *  (x, y) is the tail tip; the bubble sits above it. tail "left" | "right" | "centre" says where the tail leaves */
    bubble(x, y, s, { size = 18, pad = 14, tail = "centre", u = Math.max(2, Math.round(size / 6)) } = {}) {
      const tw = textWidth(s, size);
      const w = Math.round(tw + pad * 2);
      const h = Math.round(size * 1.15 + pad * 1.6);
      const tailH = u * 4;
      const bx = tail === "left" ? x - u * 4 : tail === "right" ? x - w + u * 6 : x - w / 2;
      const by = y - tailH - h;
      // shadow
      out.push(r(bx + u, by + u, w - u, h, C.pink));
      // body with stepped corners
      out.push(r(bx + u, by, w - 2 * u, h, C.cloud), r(bx, by + u, w, h - 2 * u, C.cloud));
      // tail: three steps narrowing to the tip
      const tx = tail === "left" ? bx + u * 3 : tail === "right" ? bx + w - u * 7 : x - u * 2;
      out.push(r(tx + u, by + h, u * 3, u, C.pink));
      out.push(r(tx, by + h - u, u * 4, u * 2, C.cloud), r(tx + u, by + h + u, u * 2, u, C.cloud), r(tx + 2 * u, by + h + 2 * u, u, u, C.cloud));
      out.push(r(tx + 2 * u, by + h + 3 * u, u, u, C.pink));
      api.text(bx + w / 2, by + h / 2 + size * 0.36, s, { size, anchor: "middle" });
      return { x: bx, y: by, w, h };
    },

    svg() {
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" shape-rendering="crispEdges">${out.join("")}</svg>`;
    },
  };
  return api;
}

export function renderPixels(svg, scale = 1) {
  return new Resvg(svg, { fitTo: { mode: "zoom", value: scale }, font: { loadSystemFonts: false, fontFiles: FONT_FILES, defaultFontFamily: FAMILY.semibold }, shapeRendering: 0 }).render();
}

export function renderPng(svg, scale = 1) {
  return renderPixels(svg, scale).asPng();
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
// Finder sizes a dmg background by its dpi while dmg-builder (electron-builder 26.15.3) sizes the window by its pixels,
// so both images carry 72 dpi; `tiffutil -cathidpicheck` marks the @2x as 144 dpi in the TIFF.
const PIXELS_PER_METRE_AT_72_DPI = 2835;

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** an opaque 72 dpi RGB png; Finder shows its own window colour through any transparent pixel, so none may be */
export function opaquePng72(image) {
  const { width, height, pixels } = image;
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    for (let x = 0; x < width; x++) {
      const s = (y * width + x) * 4;
      if (pixels[s + 3] !== 255) throw new Error(`scene leaves pixel ${x},${y} transparent`);
      pixels.copy(raw, y * (stride + 1) + 1 + x * 3, s, s + 3);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const density = Buffer.alloc(9);
  density.writeUInt32BE(PIXELS_PER_METRE_AT_72_DPI, 0);
  density.writeUInt32BE(PIXELS_PER_METRE_AT_72_DPI, 4);
  density[8] = 1;
  return Buffer.concat([PNG_SIGNATURE, chunk("IHDR", header), chunk("pHYs", density), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

/** a 24-bit bottom-up BMP, the only image format NSIS installer pages take */
export function bmp24(image) {
  const { width, height, pixels } = image;
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const size = 54 + rowSize * height;
  const b = Buffer.alloc(size);
  b.write("BM", 0, "latin1");
  b.writeUInt32LE(size, 2);
  b.writeUInt32LE(54, 10);
  b.writeUInt32LE(40, 14);
  b.writeInt32LE(width, 18);
  b.writeInt32LE(height, 22);
  b.writeUInt16LE(1, 26);
  b.writeUInt16LE(24, 28);
  b.writeUInt32LE(rowSize * height, 34);
  b.writeInt32LE(2835, 38);
  b.writeInt32LE(2835, 42);
  for (let y = 0; y < height; y++) {
    const row = 54 + (height - 1 - y) * rowSize;
    for (let x = 0; x < width; x++) {
      const s = (y * width + x) * 4;
      b[row + x * 3] = pixels[s + 2];
      b[row + x * 3 + 1] = pixels[s + 1];
      b[row + x * 3 + 2] = pixels[s];
    }
  }
  return b;
}
