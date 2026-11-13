const DEFAULT_BOUNDS = Object.freeze({ width: 1040, height: 760 });
// grok bot keeps its window 520 tall at least; the width stops at the md breakpoint, where the phone layout would begin.
const MIN_BOUNDS = Object.freeze({ width: 768, height: 520 });

const integer = (value) => Number.isFinite(value) && Number.isInteger(value);
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

function parseWindowState(raw) {
  let value;
  try {
    value = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || !value.bounds || typeof value.bounds !== "object") return null;
  const { x, y, width, height } = value.bounds;
  if (![x, y, width, height].every(integer) || width <= 0 || height <= 0) return null;
  return {
    bounds: { x, y, width, height },
    maximized: value.maximized === true,
  };
}

function intersectionArea(a, b) {
  const width = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const height = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return width * height;
}

function validWorkAreas(workAreas) {
  return workAreas.filter(
    (area) =>
      area &&
      [area.x, area.y, area.width, area.height].every(integer) &&
      area.width > 0 &&
      area.height > 0,
  );
}

/** `bounds` kept whole on one of `workAreas` (the primary display first): on the display it overlaps most, shrunk to fit
 * it and slid inside its edges; a window on no display at all is centred on the primary. Null without a usable display. */
function fitBounds(bounds, workAreas, minimum = MIN_BOUNDS) {
  const areas = validWorkAreas(workAreas);
  const primary = areas[0];
  if (!primary) return null;
  let target = primary;
  let bestArea = 0;
  for (const area of areas) {
    const overlap = intersectionArea(bounds, area);
    if (overlap > bestArea) {
      bestArea = overlap;
      target = area;
    }
  }
  const width = clamp(bounds.width, Math.min(minimum.width, target.width), target.width);
  const height = clamp(bounds.height, Math.min(minimum.height, target.height), target.height);
  if (bestArea === 0) return centeredOn(target, width, height);
  return {
    x: clamp(bounds.x, target.x, target.x + target.width - width),
    y: clamp(bounds.y, target.y, target.y + target.height - height),
    width,
    height,
  };
}

function centeredOn(area, width, height) {
  return { x: area.x + Math.round((area.width - width) / 2), y: area.y + Math.round((area.height - height) / 2), width, height };
}

/** workAreas must put the primary display first. A first launch opens centred on the primary display, sized to fit it. */
function resolveWindowState(state, workAreas, defaults = DEFAULT_BOUNDS) {
  const areas = validWorkAreas(workAreas);
  const primary = areas[0];
  const parsed = parseWindowState(state);
  if (!primary) return { bounds: { width: defaults.width, height: defaults.height }, maximized: false };
  if (!parsed) {
    return { bounds: centeredOn(primary, Math.min(defaults.width, primary.width), Math.min(defaults.height, primary.height)), maximized: false };
  }
  return { bounds: fitBounds(parsed.bounds, areas), maximized: parsed.maximized };
}

/** Whether two bounds are the same place and size. */
function sameBounds(a, b) {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

function normalizeUnreadCount(value) {
  if (!Number.isFinite(value)) return 0;
  return clamp(Math.trunc(value), 0, 999);
}

module.exports = {
  DEFAULT_BOUNDS,
  MIN_BOUNDS,
  fitBounds,
  sameBounds,
  normalizeUnreadCount,
  parseWindowState,
  resolveWindowState,
};
