import { useLayoutEffect, useRef, type RefObject } from "react";

const EASE_OUT = "cubic-bezier(0.22, 1, 0.36, 1)";

function reducedMotion(): boolean {
  if (typeof window === "undefined" || typeof document === "undefined") return false;
  if (document.documentElement.dataset.reducedMotion === "true") return true;
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** A bot that moves up on activity slides to its new place, and the rows it passes slide a slot to make room (FLIP over
 * 300ms on the out curve, the layout spring's feel with no bounce). Only lists that order themselves move this way:
 * a draggable list keeps the order it was given, and a drop or a keyboard move lands where it is put. Rows share a
 * height in a list, so a row's old place is where the row now at its old index sits. Searching changes rows at once. */
export function useActivityReorder(root: RefObject<HTMLElement | null>, enabled: boolean) {
  const last = useRef<Map<Element, string[]>>(new Map());
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const next = new Map<Element, string[]>();
    for (const row of el.querySelectorAll<HTMLElement>("[data-sidebar-bot-row]")) {
      const box = row.parentElement;
      const list = box?.parentElement;
      if (!box || !list || box.hasAttribute("data-bot-reorder-row")) continue;
      const ids = next.get(list) ?? [];
      ids.push(row.dataset.sidebarBotRow ?? "");
      next.set(list, ids);
    }
    const prev = last.current;
    last.current = next;
    if (!enabled || reducedMotion()) return;
    for (const [list, ids] of next) {
      const was = prev.get(list);
      if (!was || was.length !== ids.length || was.join("\n") === ids.join("\n") || ids.some((id) => !was.includes(id))) continue;
      const boxes = ids.map((id) => list.querySelector<HTMLElement>(`[data-sidebar-bot-row="${CSS.escape(id)}"]`)?.parentElement ?? null);
      if (boxes.some((box) => !box || typeof box.animate !== "function")) continue;
      const tops = boxes.map((box) => box!.offsetTop);
      ids.forEach((id, index) => {
        const from = was.indexOf(id);
        if (from === index) return;
        const dy = tops[from]! - tops[index]!;
        boxes[index]!.animate([{ transform: `translateY(${dy}px)` }, { transform: "none" }], { duration: 300, easing: EASE_OUT });
      });
    }
  });
}

/** Back from avatars to names, the names slide in 10px behind the widening sidebar, 60ms then 40ms a row (the ones in
 * view). Going to avatars they leave at once. */
export function useNamesReturn(root: RefObject<HTMLElement | null>, rail: boolean) {
  const was = useRef(rail);
  useLayoutEffect(() => {
    const before = was.current;
    was.current = rail;
    const el = root.current;
    if (!before || rail || !el) return;
    const reduce = reducedMotion();
    const view = el.getBoundingClientRect();
    let index = 0;
    for (const words of el.querySelectorAll<HTMLElement>("[data-row-words]")) {
      if (typeof words.animate !== "function") return;
      const box = words.getBoundingClientRect();
      if (!box.height || box.bottom < view.top || box.top > view.bottom) continue;
      words.animate(reduce ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 0, transform: "translateX(-10px)" }, { opacity: 1, transform: "none" }],
        { duration: reduce ? 150 : 320, delay: reduce ? 0 : 60 + Math.min(index, 10) * 40, easing: EASE_OUT, fill: "backwards" });
      index += 1;
    }
  }, [root, rail]);
}
