import { animate, type AnimationPlaybackControls, type MotionValue } from "motion/react";

/** The bencho token set (~/dusk-ref BENCHO-MOTION.md): every phone surface draws from these and nothing else. */
export const dur = { fast: 0.16, base: 0.22, slow: 0.42, long: 0.6 } as const;
export const ease = {
  out: [0.22, 1, 0.36, 1] as const,
  pop: [0.24, 1.34, 0.38, 1] as const,
  release: [0.28, 1.4, 0.36, 1] as const,
  menuIn: [0.16, 1, 0.3, 1] as const,
};
export const spring = {
  settle: { type: "spring", stiffness: 380, damping: 34 } as const,
  lively: { type: "spring", stiffness: 500, damping: 18 } as const,
  modal: { type: "spring", stiffness: 340, damping: 30, mass: 0.8 } as const,
  popover: { type: "spring", stiffness: 420, damping: 34, mass: 0.7 } as const,
  panel: { type: "spring", stiffness: 320, damping: 32, mass: 0.7 } as const,
};
export const withFade = <T extends object>(s: T) => ({ ...s, opacity: { duration: dur.fast } });

/** The software keyboard's own curve: iOS slides it on a damped spring that this bezier traces within a frame, Android
 * on its emphasized decelerate. */
export const keyboardCurve = {
  ios: { duration: 0.25, css: "cubic-bezier(.32,.72,0,1)", bezier: [0.32, 0.72, 0, 1] as const },
  android: { duration: 0.28, css: "cubic-bezier(.2,0,0,1)", bezier: [0.2, 0, 0, 1] as const },
};

export function prefersReducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Rubber band past an edge, as UIScrollView: the further you pull the less it gives. `limit` is the asymptote. */
export function rubberband(overshoot: number, limit: number, coefficient = 0.55): number {
  if (overshoot === 0) return 0;
  const sign = Math.sign(overshoot);
  const distance = Math.abs(overshoot);
  return sign * (1 - 1 / ((distance * coefficient) / limit + 1)) * limit;
}

/** Where a released gesture would come to rest if left to decelerate: UIScrollView's normal rate, in px and px/s. */
export function projectRelease(position: number, velocity: number, decelerationRate = 0.998): number {
  return position + (velocity / 1000) * decelerationRate / (1 - decelerationRate);
}

/** Hands a gesture's release velocity to a spring, so the settle starts at the finger's speed. Reduced motion cuts to a
 * short fade-length tween instead. */
export function settleTo(value: MotionValue<number>, target: number, velocity: number, onDone?: () => void, options?: { stiffness?: number; damping?: number; restDelta?: number }): AnimationPlaybackControls {
  if (prefersReducedMotion()) return animate(value, target, { duration: dur.fast, ease: ease.out, onComplete: onDone });
  return animate(value, target, {
    type: "spring",
    stiffness: options?.stiffness ?? spring.settle.stiffness,
    damping: options?.damping ?? spring.settle.damping,
    velocity,
    restDelta: options?.restDelta ?? 0.5,
    restSpeed: 10,
    onComplete: onDone,
  });
}

/** Tracks pointer velocity over the last ~80 ms, enough to read a flick without being thrown by the final jitter. */
export function velocityTracker() {
  let samples: Array<{ t: number; x: number; y: number }> = [];
  return {
    reset(x: number, y: number) { samples = [{ t: performance.now(), x, y }]; },
    push(x: number, y: number) {
      const t = performance.now();
      samples.push({ t, x, y });
      while (samples.length > 2 && t - samples[0].t > 80) samples.shift();
    },
    velocity(): { x: number; y: number } {
      if (samples.length < 2) return { x: 0, y: 0 };
      const first = samples[0], last = samples[samples.length - 1];
      const dt = (last.t - first.t) / 1000;
      if (dt <= 0) return { x: 0, y: 0 };
      return { x: (last.x - first.x) / dt, y: (last.y - first.y) / dt };
    },
  };
}
