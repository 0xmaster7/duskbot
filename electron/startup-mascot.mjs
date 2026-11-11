import { restSvg } from "./mascot-geometry.mjs";

export const BOOT_MASCOT_COLOR = "#B3BAC4";

/** `size` in CSS px. The same squircle a new bot wears, at rest. */
export function bootMascotSvg({ size = 56 } = {}) {
  return restSvg("squircle", { colour: BOOT_MASCOT_COLOR, className: "boot-mascot", attrs: `width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg"` });
}

/** A slow breath while the app loads, standing on its foot; still under reduced motion. */
export const BOOT_MASCOT_CSS = ".boot-mascot{transform-origin:50% 88%;animation:boot-mascot-breathe 1.6s ease-in-out infinite alternate}"
  + "@keyframes boot-mascot-breathe{from{transform:scale(1,1)}to{transform:scale(.97,1.04)}}"
  + "@media(prefers-reduced-motion:reduce){.boot-mascot{animation:none}}";

/** Shown beside #root until the app renders into it, faded in late so a quick load never flashes it. */
export function bootShellHtml() {
  return `<style>#boot-shell{position:fixed;inset:0;display:grid;place-items:center;pointer-events:none;animation:boot-shell-in 200ms ease-out 350ms both}`
    + `#root:not(:empty)+#boot-shell{display:none}@keyframes boot-shell-in{from{opacity:0}to{opacity:1}}${BOOT_MASCOT_CSS}</style>`
    + `<div id="boot-shell" aria-hidden="true">${bootMascotSvg()}</div>`;
}
