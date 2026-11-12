// electron-builder packages electron/ only, so the logo's grid lives here as well as in build/logo.mjs.

const LOGO_PALETTE = ["#06bafd", "#212121", "#3cd0fd", "#43d1fd", "#87e2fc", "#90e4fc", "#c2ecfc", "#c6f43a", "#c9f63f", "#ccf746", "#d0cefb", "#ffffff"];
const LOGO_ROWS = [
  "000000000000000000000000000000000", "000000000000000000000000000000000", "000000000000000000000000000000000",
  "000000000000000000000000000000000", "222222222222222222222222222222222", "222222222222222222222222222222222",
  "22222222b22222222222222b222222222", "22222222bb222222222222bb222222222", "2222222bbbb2222222222bbbb22222222",
  "2222222bbbbb22222222bbbbb22222222", "2222222bbbbbb222222bbbbbb22222222", "2222222bbbbbbbbbbbbbbbbbb22222222",
  "3333333bbbbbbbbbbbbbbbbbb33333333", "3333333bbbbbbbbbbbbbbbbbb33333333", "3333333bbbbbbbbbbbbbbbbbb33333333",
  "444444bbbbbbbbbbbbbbbbbbbb4444444", "444444bbbb111bbbbbb111bbbb4444444", "555555bbbb111bbbbbb111bbbb5555555",
  "666666bbbb111bbbbbb111bbbb6666666", "666666bbbb111bbbbbb111bbbb6666666", "666666bbbb111bbbbbb111bbbb6666666",
  "aaaaaabbbb111bbbbbb111bbbb6888888", "8aaa88bbbbbbbbbbbbbbbbbbbb8888888", "877788bbbbbbbbbbbbbbbbbbbb8888887",
  "8777888bbbbbbbbbbbbbbbbbb88888887", "88888887bbbbbbbbbbbbbbbb888887888", "7888778888bbbbbbbbbbbb77787887888",
  "788877888888888888888888888888888", "788877778888888888788888888888887", "888888888888888888788778877888778",
  "888888778888887888888887787888888", "888888778888887888888888787888888", "788788888888888888899888887887888",
];
export const LOGO_GRID = LOGO_ROWS.map(row => [...row].map(c => LOGO_PALETTE[parseInt(c, 16)]));

export function rects(grid, { x = 0, y = 0, cell = 1 } = {}) {
  let out = "";
  grid.forEach((row, j) => {
    for (let i = 0; i < row.length;) {
      const c = row[i];
      let k = i + 1;
      while (k < row.length && row[k] === c) k++;
      if (c) out += `<rect x="${x + i * cell}" y="${y + j * cell}" width="${(k - i) * cell}" height="${cell}" fill="${c}"/>`;
      i = k;
    }
  });
  return out;
}

export const logoSvg = () => `<svg class="logo" width="33" height="33" viewBox="0 0 33 33" shape-rendering="crispEdges" aria-hidden="true">`
  + `<clipPath id="logo-tile"><rect width="33" height="33" rx="5"/></clipPath><g clip-path="url(#logo-tile)">${rects(LOGO_GRID)}</g></svg>`;

// the bots' rest frames from the site's pixel engine: body with eye holes, then eyes
export const SPRITES = Object.freeze({
  pip: { body: "M5 4h6v1h-6zM4 5h8v1h-8zM3 6h10v1h-10zM2 7h2v4h-2zM6 7h4v4h-4zM12 7h2v4h-2zM2 11h12v2h-12zM3 13h10v1h-10zM4 14h8v1h-8zM5 15h6v1h-6z", eyes: "M4 7h2v4h-2zM10 7h2v4h-2z" },
  mochi: { body: "M3 8h10v1h-10zM2 9h12v1h-12zM1 10h2v3h-2zM5 10h6v3h-6zM13 10h2v3h-2zM1 13h14v2h-14zM2 15h12v1h-12z", eyes: "M3 10h2v3h-2zM11 10h2v3h-2z" },
  loaf: { body: "M4 6h8v1h-8zM3 7h10v1h-10zM2 8h12v1h-12zM2 9h2v3h-2zM6 9h4v3h-4zM12 9h2v3h-2zM2 12h12v2h-12zM3 14h10v1h-10zM4 15h8v1h-8z", eyes: "M4 9h2v3h-2zM10 9h2v3h-2z" },
  kit: { body: "M2 2h2v1h-2zM12 2h2v1h-2zM2 3h3v2h-3zM11 3h3v2h-3zM2 5h4v1h-4zM10 5h4v1h-4zM2 6h12v2h-12zM1 8h14v1h-14zM1 9h3v3h-3zM6 9h4v3h-4zM12 9h3v3h-3zM1 12h14v1h-14zM2 13h12v2h-12zM3 15h10v1h-10z", eyes: "M4 9h2v3h-2zM10 9h2v3h-2z" },
});

export const sprite = (name, cell, eyes = "var(--eye)") => {
  const s = SPRITES[name];
  return `<g transform="scale(${cell})"><path class="body" d="${s.body}"/><path class="body" d="${s.eyes}"/><path class="eyes" fill="${eyes}" d="${s.eyes}"/></g>`;
};

// # cream top, = lemon underside
const CLOUD = [
  "...............##########...............",
  "........###################.............",
  ".......##############################...",
  "....####################################",
  "..######################################",
  ".#######################################",
  "========================================",
  ".======================================.",
  "...============....=================...",
];
const PUFF = [
  ".......######.....",
  "...############...",
  ".################.",
  "==================",
  "..====......====..",
];
const gridOf = (rows, map) => rows.map(row => [...row].map(c => map[c] ?? null));
export const cloudSvg = (cell = 4) => rects(gridOf(CLOUD, { "#": "var(--cloud-top)", "=": "var(--cloud-under)" }), { cell });
export const puffSvg = (cell = 3) => rects(gridOf(PUFF, { "#": "var(--puff-top)", "=": "var(--puff-under)" }), { cell });

const seeded = seed => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

export function hillsSvg({ cols = 110, rows = 6, cell = 4, bottom = 248 } = {}) {
  let out = "";
  for (let i = 0; i < cols; i++) {
    const h = Math.max(1, Math.round(rows * (0.55 + 0.3 * Math.sin(i / 7.5) + 0.15 * Math.sin(i / 2.7 + 1))));
    out += `<rect x="${i * cell}" y="${bottom - h * cell}" width="${cell}" height="${h * cell}"/>`;
  }
  return out;
}

export function meadowSvg({ width = 440, top = 248, height = 52, cell = 4 } = {}) {
  const rnd = seeded(7);
  let tufts = "", specks = "";
  for (let x = 0; x < width; x += cell) if (rnd() < 0.42) tufts += `<rect x="${x}" y="${top - cell}" width="${cell}" height="${cell}"/>`;
  for (let n = 0; n < 34; n++) {
    const x = Math.floor(rnd() * (width / cell)) * cell, y = top + cell * (1 + Math.floor(rnd() * (height / cell - 1)));
    specks += `<rect x="${x}" y="${y}" width="${cell * (rnd() < 0.5 ? 1 : 2)}" height="${cell}"/>`;
  }
  return `<rect class="grass" x="0" y="${top}" width="${width}" height="${height}"/><g class="grass">${tufts}</g><g class="speck">${specks}</g>`;
}

const PETALS = ["var(--pink)", "var(--lemon)", "var(--petal)", "var(--lilac)"];
export function flowersSvg({ count = 12, width = 440, top = 248, cell = 4 } = {}) {
  const rnd = seeded(11);
  let out = "";
  for (let i = 0; i < count; i++) {
    const x = Math.round((14 + (i + 0.5) * ((width - 28) / count) + (rnd() - 0.5) * 12) / cell) * cell;
    const y = top + 8 + Math.floor(rnd() * 4) * cell;
    const petal = PETALS[i % PETALS.length], heart = i % 4 === 1 ? "var(--pink-deep)" : "var(--lemon-deep)";
    out += `<g transform="translate(${x} ${y})"><g class="flower">`
      + `<rect x="${cell}" y="0" width="${cell}" height="${cell}" fill="${petal}"/>`
      + `<rect x="0" y="${cell}" width="${cell * 3}" height="${cell}" fill="${petal}"/>`
      + `<rect x="${cell}" y="${cell}" width="${cell}" height="${cell}" fill="${heart}"/>`
      + `<rect x="${cell}" y="${cell * 2}" width="${cell}" height="${cell}" fill="${petal}"/>`
      + `<rect x="${cell}" y="${cell * 3}" width="${cell}" height="${cell * 2}" fill="var(--stem)"/></g></g>`;
  }
  return out;
}

export function starsSvg() {
  const rnd = seeded(3);
  let out = "";
  for (let n = 0; n < 9; n++) {
    const x = 260 + Math.floor(rnd() * 40) * 4, y = Math.floor(rnd() * 22) * 4 + 8, size = rnd() < 0.3 ? 4 : 2;
    out += `<rect class="star" style="--d:${(rnd() * 3).toFixed(2)}s" x="${x}" y="${y}" width="${size}" height="${size}"/>`;
  }
  return out;
}
