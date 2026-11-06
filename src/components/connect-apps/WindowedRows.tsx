import { useEffect, useMemo, useRef, useState, type ReactElement, type RefObject } from "react";

/** A 64px row (40px tile, 12px padding) and the grid's 2px gap. */
export const ROW_PITCH = 66;
const OVERSCAN = 4;
// the sections' @xl container query (36rem): two columns from there
const TWO_COLUMNS = 576;

export interface RowWindow { first: number; last: number; columns: number }

/** Which rows of `count` items show in a scroller `viewport` tall, the list starting `top` px below its top edge. */
export function rowWindow(count: number, columns: number, top: number, viewport: number): RowWindow {
  const rows = Math.ceil(count / columns);
  const first = Math.min(rows, Math.max(0, Math.floor(-top / ROW_PITCH) - OVERSCAN));
  const last = Math.min(rows, Math.max(first, Math.ceil((viewport - top) / ROW_PITCH) + OVERSCAN));
  return { first, last, columns };
}

/** A long list of fixed-height rows that draws only those in view plus a few either side; the box keeps the whole list's
 * height, so the scrollbar and everything after it stay put. A row already drawn is the same element on the next frame,
 * so scrolling renders only the rows that come into view. */
export function WindowedRows<T extends { id: string }>({ items, scroller, render }: {
  items: readonly T[];
  scroller: RefObject<HTMLElement | null>;
  render: (item: T) => ReactElement;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<RowWindow>(() => rowWindow(items.length, 1, 0, 1200));
  const count = items.length;

  // a passive effect: the scroller is an ancestor, and its ref is set only after this row list's layout effects ran
  useEffect(() => {
    const element = scroller.current;
    const own = box.current;
    if (!element || !own) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const columns = own.clientWidth >= TWO_COLUMNS ? 2 : 1;
      const top = own.getBoundingClientRect().top - element.getBoundingClientRect().top;
      const next = rowWindow(count, columns, top, element.clientHeight);
      setView((current) => current.first === next.first && current.last === next.last && current.columns === next.columns ? current : next);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    measure();
    element.addEventListener("scroll", schedule, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    observer?.observe(element);
    observer?.observe(own);
    return () => {
      cancelAnimationFrame(frame);
      element.removeEventListener("scroll", schedule);
      observer?.disconnect();
    };
  }, [scroller, count]);

  // a row drawn for these items stays the same element while only the scroll position changes
  const drawn = useMemo(() => new Map<string, ReactElement>(), [items, render]);
  const rows = Math.ceil(count / view.columns);
  const shown = items.slice(view.first * view.columns, view.last * view.columns);
  return (
    <div ref={box} className="ca-window col-span-full" style={{ height: rows ? rows * ROW_PITCH - 2 : 0 }}>
      <div className="grid grid-cols-1 items-start gap-x-2 gap-y-0.5 @xl:grid-cols-2" style={{ transform: `translateY(${view.first * ROW_PITCH}px)` }}>
        {shown.map((item) => {
          let row = drawn.get(item.id);
          if (!row) {
            row = render(item);
            drawn.set(item.id, row);
          }
          return row;
        })}
      </div>
    </div>
  );
}
