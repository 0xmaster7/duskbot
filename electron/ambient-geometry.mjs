// Where the notch island and the bot dock sit on a display. Pure math on electron's Display shape, so it is tested
// without electron. Electron reports no safe area, so a notch is read from the menu bar: on a notched Mac the menu
// bar is exactly as tall as the notch (37 to 38 pt at the default scale, 24 to 25 pt on a Mac without one).

export const ISLAND_SIZES = Object.freeze({
  small: Object.freeze({ side: 34, pill: 184, pillHeight: 30, tile: 18 }),
  medium: Object.freeze({ side: 42, pill: 208, pillHeight: 34, tile: 20 }),
  large: Object.freeze({ side: 52, pill: 236, pillHeight: 38, tile: 24 }),
});
export const ISLAND_SIZE_IDS = Object.freeze(Object.keys(ISLAND_SIZES));
/** The window holds the panel at its largest, transparent and click-through outside the island's shape. */
export const ISLAND_WINDOW = Object.freeze({ width: 560, height: 500 });
/** A pill floats this far below the top of a display without a notch. */
export const PILL_TOP = 6;
const NOTCH_MIN_MENU_BAR = 30;
const NOTCH_FALLBACK_HEIGHT = 37;
/** Notch width over its height, measured on the 14 and 16 inch MacBook Pro (about 185 x 32 pt at the default scale,
 * with a 37 pt menu bar): erring wide keeps the island from ever being smaller than the notch. */
const NOTCH_ASPECT = 5.2;

export const DOCK = Object.freeze({ cell: 52, tile: 34, body: 64, pad: 10, ear: 18, sliver: 6, cardRoom: 300, spill: 64, max: 12 });
export const DISPLAY_CHOICES = Object.freeze(["active", "built-in", "main"]);

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const rect = value => value && Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.width) && Number.isFinite(value.height);

/** The camera housing at the top of a built-in display, or null. */
export function notchOf(display, platform) {
  if (platform !== "darwin" || !display || display.internal !== true || !rect(display.bounds) || !rect(display.workArea)) return null;
  const menuBar = Math.max(0, display.workArea.y - display.bounds.y);
  // an auto-hidden menu bar leaves no room to measure: the panel's name says whether it has the notch
  const notched = menuBar >= NOTCH_MIN_MENU_BAR || (menuBar === 0 && /liquid retina/i.test(String(display.label ?? "")));
  if (!notched) return null;
  const height = menuBar >= NOTCH_MIN_MENU_BAR ? menuBar : NOTCH_FALLBACK_HEIGHT;
  return { width: clamp(Math.round(height * NOTCH_ASPECT), 160, 260), height };
}

/** The island window's bounds and the collapsed shape inside it: hugging the notch, or a floating pill. */
export function islandLayout(display, { platform, size = "medium" } = {}) {
  const s = ISLAND_SIZES[size] ?? ISLAND_SIZES.medium;
  const { bounds } = display;
  const notch = notchOf(display, platform);
  const width = ISLAND_WINDOW.width, height = ISLAND_WINDOW.height;
  const window = { x: Math.round(bounds.x + (bounds.width - width) / 2), y: bounds.y, width, height };
  const collapsed = notch
    ? { kind: "notch", width: notch.width + 2 * s.side, height: notch.height, top: 0, notch: notch.width }
    : { kind: "pill", width: s.pill, height: s.pillHeight, top: PILL_TOP, notch: 0 };
  return { window, collapsed, tile: s.tile, size: ISLAND_SIZES[size] ? size : "medium" };
}

/** The dock's body height for this many bots and the ＋, capped to the display. */
export function dockBodyHeight(count, workHeight) {
  const rows = clamp(Math.floor(Number(count) || 0), 0, DOCK.max) + 1;
  const wanted = DOCK.pad * 2 + rows * DOCK.cell;
  const room = Math.max(DOCK.cell * 2, workHeight - 2 * (DOCK.ear + DOCK.spill) - 40);
  return Math.min(wanted, room);
}

/** The dock window against the right edge of the work area (left of a Dock pinned right), centred top to bottom. */
export function dockLayout(display, { count = 0 } = {}) {
  const area = display.workArea;
  const body = dockBodyHeight(count, area.height);
  const width = DOCK.body + DOCK.cardRoom;
  const height = Math.min(area.height, body + 2 * (DOCK.ear + DOCK.spill));
  const window = { x: area.x + area.width - width, y: Math.round(area.y + (area.height - height) / 2), width, height };
  return { window, body, top: Math.round((height - body) / 2) };
}

const contains = (bounds, point) => point.x >= bounds.x && point.x < bounds.x + bounds.width && point.y >= bounds.y && point.y < bounds.y + bounds.height;

/** The display the surfaces live on: the one under the pointer, the built-in one, or the main one. */
export function pickDisplay(displays, choice, { primary, cursor } = {}) {
  const list = Array.isArray(displays) ? displays.filter(display => rect(display?.bounds)) : [];
  const main = list.find(display => display.id === primary?.id) ?? primary ?? list[0] ?? null;
  if (choice === "built-in") return list.find(display => display.internal === true) ?? main;
  if (choice === "main") return main;
  if (cursor && Number.isFinite(cursor.x) && Number.isFinite(cursor.y)) return list.find(display => contains(display.bounds, cursor)) ?? main;
  return main;
}
