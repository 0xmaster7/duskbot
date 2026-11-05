// shared motion values for the `motion` package, read from Grok Bot's own bundle.
// pass a preset as `transition`; under reduced motion use `REDUCED` and drop the movement, keep the fade.

/** a press, a toggle thumb, a tab indicator: Grok's critically damped snap */
export const SPRING_SNAP = { type: "spring", stiffness: 1000, damping: 63, mass: 1 } as const;

/** a menu, popover or panel arriving: Grok's default UI spring */
export const SPRING_UI = { type: "spring", stiffness: 175, damping: 26, mass: 1 } as const;

/** a larger surface settling (a sheet, a card moving into place) */
export const SPRING_SOFT = { type: "spring", stiffness: 100, damping: 20, mass: 1 } as const;

/** entering or leaving; the same curve as the --animate-* tokens in styles.css */
export const EASE_OUT = [0.22, 1, 0.36, 1] as const;

/** movement on screen; Grok's 300ms tween curve */
export const EASE_IN_OUT = [0.2, 0, 0, 1] as const;

/** seconds, as motion takes them */
export const DURATION = { fast: 0.12, base: 0.2, slow: 0.3 } as const;

/** Grok's reduced-motion stand-in: a short fade, no travel */
export const REDUCED = { duration: 0.12, ease: "easeOut" } as const;
