import { planBotDrop, type BotDrop, type BotLists, type BotMove } from "./sidebar-bot-drop";

/** A mouse or pen press turns into a drag once it moves this far, so a plain click still opens the chat. */
export const DRAG_SLOP = 5;
/** A finger holds this long before the row lifts; moving further than TOUCH_SLOP first is a scroll. */
export const TOUCH_HOLD_MS = 250;
export const TOUCH_SLOP = 8;
/** Rows make room on the row ease the sidebar already uses. */
export const SLIDE_MS = 180;
export const SLIDE_EASE = "cubic-bezier(.22,1,.36,1)";

/** A bot row as it stood when the drag began, in the list's scroll coordinates. */
export type ReorderRow = { id: string; list: string; top: number; height: number };
/** A section's box. `list` null: bots cannot be dropped there (group chats, pins). */
export type ReorderZone = { id: string; list: string | null; top: number; bottom: number };
export type ReorderSnapshot = { rows: ReorderRow[]; zones: ReorderZone[]; gap: number };
/** Where the dragged bot would go: `index` among its new list's other rows. A folded section takes it at its end. */
export type ReorderTarget = { list: string; index: number; folded: boolean };
export type ReorderShifts = { rows: Map<string, number>; zones: Map<string, number> };

export type PressKind = "mouse" | "touch";
export type Press = { kind: PressKind; x: number; y: number; at: number };

/** What a press that has not lifted yet does now: keep waiting, lift the row, or give up (a finger that scrolls). */
export function pressStep(press: Press, x: number, y: number, now: number): "wait" | "drag" | "abandon" {
  const moved = Math.hypot(x - press.x, y - press.y);
  if (press.kind === "mouse") return moved >= DRAG_SLOP ? "drag" : "wait";
  if (now - press.at < TOUCH_HOLD_MS) return moved > TOUCH_SLOP ? "abandon" : "wait";
  return "drag";
}

const rowsOf = (snapshot: ReorderSnapshot, list: string, without: string) => snapshot.rows.filter((row) => row.list === list && row.id !== without);
const zoneOf = (snapshot: ReorderSnapshot, list: string) => snapshot.zones.find((zone) => zone.list === list);

/** The section under `y` (the dragged row's centre), or the nearest one when `y` falls between them. */
function zoneAt(zones: readonly ReorderZone[], y: number): ReorderZone | undefined {
  let best: ReorderZone | undefined, distance = Infinity;
  for (const zone of zones) {
    const away = y < zone.top ? zone.top - y : y > zone.bottom ? y - zone.bottom : 0;
    if (away < distance) { best = zone; distance = away; }
  }
  return best;
}

/** Where the dragged row's centre at `y` puts it. Rows are compared at the places they had when the drag began, so the
 * answer never wobbles as they slide. Null over a section that takes no bots. A section whose rows are all hidden is
 * folded: the bot goes in at its end. */
export function reorderTarget(snapshot: ReorderSnapshot, lists: BotLists, botId: string, y: number): ReorderTarget | null {
  const zone = zoneAt(snapshot.zones, y);
  if (!zone || zone.list === null || !lists.has(zone.list)) return null;
  const others = rowsOf(snapshot, zone.list, botId);
  const folded = others.length === 0 && (lists.get(zone.list) ?? []).some((id) => id !== botId);
  if (folded) return { list: zone.list, index: 0, folded: true };
  return { list: zone.list, index: others.filter((row) => row.top + row.height / 2 < y).length, folded: false };
}

export function sameTarget(a: ReorderTarget | null, b: ReorderTarget | null): boolean {
  if (!a || !b) return a === b;
  return a.list === b.list && a.index === b.index && a.folded === b.folded;
}

/** How far each row and section slides to open a gap at `target` and close the one the dragged row left. A section is
 * moved whole when everything in it sits between the two; its rows past the gap are moved back by the same amount. */
export function reorderShifts(snapshot: ReorderSnapshot, botId: string, target: ReorderTarget | null): ReorderShifts {
  const shifts: ReorderShifts = { rows: new Map(), zones: new Map() };
  const dragged = snapshot.rows.find((row) => row.id === botId);
  if (!dragged || !target || target.folded) return shifts;
  const pitch = dragged.height + snapshot.gap;
  const from = rowsOf(snapshot, dragged.list, "");
  const origin = from.findIndex((row) => row.id === botId);
  const shiftRows = (rows: ReorderRow[], amount: number) => { for (const row of rows) shifts.rows.set(row.id, (shifts.rows.get(row.id) ?? 0) + amount); };
  if (target.list === dragged.list) {
    const others = rowsOf(snapshot, dragged.list, botId);
    if (target.index < origin) shiftRows(others.slice(target.index, origin), pitch);
    else shiftRows(others.slice(origin, target.index), -pitch);
    return shifts;
  }
  const zones = snapshot.zones;
  const a = zones.findIndex((zone) => zone.list === dragged.list), b = zones.findIndex((zone) => zone.list === target.list);
  if (a === -1 || b === -1) return shifts;
  const into = rowsOf(snapshot, target.list, botId).slice(target.index);
  const after = from.slice(origin + 1);
  const direction = b > a ? -1 : 1;
  for (const zone of zones.slice(Math.min(a, b) + 1, Math.max(a, b))) shifts.zones.set(zone.id, direction * pitch);
  if (direction === -1) {
    shiftRows(after, -pitch);
    shifts.zones.set(zones[b]!.id, -pitch);
    shiftRows(into, pitch);
  } else {
    shiftRows(into, pitch);
    shifts.zones.set(zones[a]!.id, pitch);
    shiftRows(after, -pitch);
  }
  return shifts;
}

/** Where a row sits once the shifts apply, in the list's scroll coordinates. */
export function shiftedTop(snapshot: ReorderSnapshot, shifts: ReorderShifts, row: ReorderRow): number {
  const zone = zoneOf(snapshot, row.list);
  return row.top + (shifts.rows.get(row.id) ?? 0) + (zone ? shifts.zones.get(zone.id) ?? 0 : 0);
}

/** The top of the gap the dragged row drops into: where it animates to, and where the insertion line is drawn. Null when
 * it would not land in a list (a folded section takes it out of sight). */
export function landingTop(snapshot: ReorderSnapshot, botId: string, target: ReorderTarget | null, shifts: ReorderShifts): number | null {
  const dragged = snapshot.rows.find((row) => row.id === botId);
  if (!dragged || !target || target.folded) return null;
  const pitch = dragged.height + snapshot.gap;
  const others = rowsOf(snapshot, target.list, botId);
  const follower = others[target.index];
  if (follower) return shiftedTop(snapshot, shifts, follower) - pitch;
  const last = others.at(-1);
  if (last) return shiftedTop(snapshot, shifts, last) + last.height + snapshot.gap;
  const zone = zoneOf(snapshot, target.list);
  return zone ? zone.bottom + (shifts.zones.get(zone.id) ?? 0) + snapshot.gap : null;
}

/** The drop the existing order rules plan from: before the row now at `index`, after the last, or into an empty list. */
export function targetDrop(lists: BotLists, botId: string, target: ReorderTarget): BotDrop {
  const others = (lists.get(target.list) ?? []).filter((id) => id !== botId);
  if (target.folded || others.length === 0) return { kind: "end", list: target.list };
  if (target.index < others.length) return { kind: "row", botId: others[target.index]!, place: "before" };
  return { kind: "row", botId: others.at(-1)!, place: "after" };
}

/** What letting go does: nothing when the drag was called off, ended over a section that takes no bots, or left the
 * bot where it was. */
export function releaseMove(lists: BotLists, botId: string, target: ReorderTarget | null, cancelled: boolean): BotMove | null {
  if (cancelled || !target) return null;
  const move = planBotDrop(lists, botId, targetDrop(lists, botId, target));
  return move?.kind === "move" ? move : null;
}

/** Pixels per frame to scroll the list while the pointer sits within `edge` of its top or bottom, faster nearer it. */
export function autoScrollStep(y: number, top: number, bottom: number, edge = 48, max = 14): number {
  if (y < top + edge) return -Math.ceil(max * Math.min(1, (top + edge - y) / edge));
  if (y > bottom - edge) return Math.ceil(max * Math.min(1, (y - (bottom - edge)) / edge));
  return 0;
}

/** Keeps the lifted row's centre within the sections, so it can still pass the middle of the very last row. */
export function clampLift(top: number, height: number, zones: readonly ReorderZone[]): number {
  if (!zones.length) return top;
  const min = Math.min(...zones.map((zone) => zone.top)) - height / 2, max = Math.max(...zones.map((zone) => zone.bottom)) - height / 2;
  return Math.min(Math.max(top, min), Math.max(min, max));
}
