/** kit, the brand mascot, at rest on its 16 grid: the body under the eyes, and the eyes. */
export const KIT_BODY = "M2 2h2v1h-2zM12 2h2v1h-2zM2 3h3v1h-3zM11 3h3v1h-3zM2 4h3v1h-3zM11 4h3v1h-3zM2 5h4v1h-4zM10 5h4v1h-4zM2 6h12v1h-12zM2 7h12v1h-12zM1 8h14v1h-14zM1 9h14v1h-14zM1 10h14v1h-14zM1 11h14v1h-14zM1 12h14v1h-14zM2 13h12v1h-12zM2 14h12v1h-12zM3 15h10v1h-10z";
export const KIT_EYES = "M4 9h2v1h-2zM10 9h2v1h-2zM4 10h2v1h-2zM10 10h2v1h-2zM4 11h2v1h-2zM10 11h2v1h-2z";

export const BOOT_MASCOT_COLOR = "#ffffff";
const BOOT_EYES = "#212121";

/** `size` in CSS px. kit at rest, white with the logo's dark eyes. */
export function bootMascotSvg({ size = 56 } = {}) {
  return `<svg class="boot-mascot" width="${size}" height="${size}" viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true" data-body="kit" xmlns="http://www.w3.org/2000/svg">`
    + `<path fill="${BOOT_MASCOT_COLOR}" d="${KIT_BODY}"/><path class="boot-eyes" fill="${BOOT_EYES}" d="${KIT_EYES}"/></svg>`;
}

/** A blink every few seconds while the app loads, as the engine's idle bots do; still under reduced motion. */
export const BOOT_MASCOT_CSS = ".boot-mascot .boot-eyes{transform-box:fill-box;transform-origin:50% 100%;animation:boot-mascot-blink 3.6s steps(1,end) infinite}"
  + "@keyframes boot-mascot-blink{0%,92%{transform:scaleY(1)}94%{transform:scaleY(.34)}97%{transform:scaleY(1)}}"
  + "@media(prefers-reduced-motion:reduce){.boot-mascot .boot-eyes{animation:none}}";

/** Shown beside #root until the app renders into it, faded in late so a quick load never flashes it. */
export function bootShellHtml() {
  return `<style>#boot-shell{position:fixed;inset:0;display:grid;place-items:center;pointer-events:none;animation:boot-shell-in 200ms ease-out 350ms both}`
    + `#root:not(:empty)+#boot-shell{display:none}@keyframes boot-shell-in{from{opacity:0}to{opacity:1}}${BOOT_MASCOT_CSS}</style>`
    + `<div id="boot-shell" aria-hidden="true">${bootMascotSvg()}</div>`;
}
