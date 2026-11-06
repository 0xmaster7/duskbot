import { useRef } from "react";

export interface MenuMotion {
  shown: boolean;
  closing: boolean;
  className: string;
  exitProps: { inert?: boolean; "aria-hidden"?: boolean };
}

/** Grok's menus, popovers and listboxes open and close raw: there on the render they open, gone on the render they
 * close. `raw-popup` only marks the surface for overlays.css (a menu draws no focus ring of its own). */
export function useMenuMotion(open: boolean): MenuMotion {
  return { shown: open, closing: false, className: "raw-popup", exitProps: {} };
}

export function useHeldMenuMotion<T>(value: T | null): MenuMotion & { value: T | null } {
  const motion = useMenuMotion(value != null);
  const held = useRef<T | null>(value);
  if (value != null) held.current = value;
  return { ...motion, value: value ?? held.current };
}
