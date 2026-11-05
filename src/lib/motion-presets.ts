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

/** a pill or reaction chip popping in: Grok's 500ms overshoot curve (peaks at 1.078), fitted */
export const SPRING_POP = { type: "spring", stiffness: 466, damping: 27, mass: 1 } as const;

/** a lively settle with a small overshoot */
export const SPRING_LIVELY = { type: "spring", stiffness: 175, damping: 18.5, mass: 1 } as const;

/** Grok's cubic-bezier set, as motion arrays */
export const EASE = {
  /** --ease-sharp: popups, tooltips, dialogs, small swaps */
  sharp: [0.165, 0.84, 0.44, 1],
  /** --ease-heavy: segmented control thumb */
  heavy: [0.645, 0.045, 0.355, 1],
  /** --ease-drawer */
  drawer: [0.32, 0.72, 0, 1],
  /** route wipes, sidebar width, rows, chat activity */
  out: [0.22, 1, 0.36, 1],
  /** layout moves: pills, reactions, hover tray, footer */
  standard: [0.2, 0, 0, 1],
  /** hover cards, offers, popIn, reactions entering */
  quint: [0.23, 1, 0.32, 1],
  /** small panels and badges */
  expo: [0.16, 1, 0.3, 1],
  /** status swap text */
  swift: [0.1, 0.9, 0.2, 1],
  /** the activity mark pop */
  back: [0.34, 1.56, 0.64, 1],
  /** exit: chip leaving */
  accelerate: [0.4, 0, 1, 1],
  /** dragged row dropping home, with a little overshoot */
  drop: [0.25, 1.15, 0.4, 1],
} as const;

/** the Anysphere ui kit duration tokens Grok uses, in seconds */
export const GROK_DURATION = {
  instant: 0.05,
  fast: 0.1,
  normal: 0.15,
  slow: 0.2,
  slower: 0.3,
  drawer: 0.5,
} as const;

/** menus, popovers, tooltips: 100ms in from 2px toward the anchor at 98% scale */
export const POPUP = {
  initial: { opacity: 0, scale: 0.98 },
  animate: { opacity: 1, scale: 1, x: 0, y: 0 },
  exit: { opacity: 0, scale: 0.98 },
  transition: { duration: GROK_DURATION.fast, ease: EASE.sharp },
  offset: 2,
} as const;

/** centered dialogs: 200ms fade and scale from 0.97, backdrop fades over the same time */
export const DIALOG = {
  initial: { opacity: 0, scale: 0.97 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.97 },
  transition: { duration: GROK_DURATION.slow, ease: EASE.sharp },
} as const;

/** a bot pinned into the grid: from 85% scale on the snap spring, fades on 300ms standard */
export const PIN_TILE = {
  initial: { opacity: 0, scale: 0.85 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.85 },
  transition: { layout: SPRING_SNAP, scale: SPRING_SNAP, opacity: { duration: 0.3, ease: EASE.standard } },
} as const;

/** a sidebar row lifted for dragging, and the drop back */
export const DRAG_LIFT = { scale: 1.04, opacity: 0.9, drop: { duration: 0.3, ease: EASE.drop } } as const;

/** list rows entering or leaving the sidebar: height and 4px rise on the snap spring, 240ms */
export const ROW_ENTER = {
  initial: { opacity: 0, height: 0, y: -4 },
  animate: { opacity: 1, height: "auto", y: 0 },
  exit: { opacity: 0, height: 0, y: -4 },
  transition: { ...SPRING_SNAP },
} as const;

/** pane push and pop: incoming slides 100% (pop: -30%), outgoing leaves -30% (pop: 100%), 200ms */
export const WIPE = { duration: 0.2, ease: EASE.out, pushFrom: "100%", popFrom: "-30%" } as const;
