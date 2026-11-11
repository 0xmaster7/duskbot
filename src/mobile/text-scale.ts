import type { MobilePlatform } from "./platform";

/** the system body size at the default Larger Text setting, in css px */
const DEFAULT_BODY_PX = 17;
/** the largest and smallest the app's text follows the setting to: its rows grow with their text, its bars do not */
export const TEXT_SCALE_MIN = 0.9;
export const TEXT_SCALE_MAX = 1.35;

/** The app's text zoom for a measured system body size. */
export function textScaleFor(bodyPx: number): number {
  if (!Number.isFinite(bodyPx) || bodyPx <= 0) return 1;
  return Math.min(TEXT_SCALE_MAX, Math.max(TEXT_SCALE_MIN, Math.round((bodyPx / DEFAULT_BODY_PX) * 100) / 100));
}

/** WebKit resolves the `-apple-system-body` font to the size the Larger Text setting asks for. */
function systemBodyPx(): number {
  const probe = document.createElement("span");
  probe.style.cssText = "font:-apple-system-body;position:absolute;visibility:hidden;pointer-events:none";
  probe.textContent = "M";
  document.body.append(probe);
  const size = Number.parseFloat(getComputedStyle(probe).fontSize);
  probe.remove();
  return size;
}

function zoomPage(percent: number): void {
  document.documentElement.style.setProperty("-webkit-text-size-adjust", `${percent}%`);
}

/** iOS Larger Text (Dynamic Type) does not reach a web view's own font sizes, so the system body size sets the page's
 * text zoom. Read again each time the app comes back, since the setting is changed outside it. Returns the stop. */
export function followSystemTextSize(platform: Pick<MobilePlatform, "kind" | "onResume">, measure: () => number = systemBodyPx, zoom: (percent: number) => void = zoomPage): () => void {
  if (platform.kind !== "ios") return () => {};
  const apply = () => zoom(Math.round(textScaleFor(measure()) * 100));
  apply();
  return platform.onResume?.(apply) ?? (() => {});
}
