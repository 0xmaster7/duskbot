import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { motion, useMotionValue, useTransform, type AnimationPlaybackControls } from "motion/react";
import { ChevronLeft, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { canScroll, ownsDrag, useDrag } from "./gesture";
import { projectRelease, rubberband, settleTo } from "./motion";
import { RoundButton } from "./RoundButton";

const EXIT = { stiffness: 520, damping: 46 };
const OPEN_SHEETS: Array<() => void> = [];

/** Closes the top sheet, for Android's back and Escape. False when none is open. */
export function closeTopSheet(): boolean {
  const close = OPEN_SHEETS.at(-1);
  if (!close) return false;
  close();
  return true;
}

export function sheetOpen(): boolean {
  return OPEN_SHEETS.length > 0;
}

/** A bottom sheet with Grok's 28pt top corners. It follows the finger down from anywhere whose scroller is at its top,
 * rubber-bands up, and on release dismisses or springs back by where the flick would land. */
export function Sheet({ open, onClose, title, label, children, full = false, back, trailing, bodyClassName, flush = false }: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  /** Accessible name when the title is not plain text. */
  label?: string;
  children: ReactNode;
  /** Fills the screen below the status bar instead of hugging its content. */
  full?: boolean;
  /** A back chevron in place of the close button, for a page inside a sheet. */
  back?: () => void;
  trailing?: ReactNode;
  bodyClassName?: string;
  /** No header row: the content draws its own. */
  flush?: boolean;
}) {
  const [mounted, setMounted] = useState(open);
  const sheetRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const height = useRef(800);
  const y = useMotionValue(typeof window === "undefined" ? 800 : window.innerHeight);
  const scrim = useTransform(y, (value) => Math.max(0, Math.min(1, 1 - value / Math.max(1, height.current))));
  const run = useRef<AnimationPlaybackControls | null>(null);
  const [moving, setMoving] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  if (open && !mounted) setMounted(true);

  const go = useCallback((target: number, velocity: number, done?: () => void, exit = false) => {
    run.current?.stop();
    setMoving(true);
    run.current = settleTo(y, target, velocity, () => { setMoving(false); done?.(); }, exit ? EXIT : undefined);
  }, [y]);

  useLayoutEffect(() => {
    if (!mounted) return;
    const sheet = sheetRef.current;
    if (!sheet) return;
    height.current = sheet.getBoundingClientRect().height;
    if (open) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      y.set(height.current);
      go(0, 0);
      sheet.focus({ preventScroll: true });
    } else {
      go(height.current + 24, 0, () => {
        setMounted(false);
        opener.current?.focus({ preventScroll: true });
      }, true);
    }
  }, [open, mounted]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    const close = () => closeRef.current();
    OPEN_SHEETS.push(close);
    return () => { OPEN_SHEETS.splice(OPEN_SHEETS.indexOf(close), 1); };
  }, [open]);

  useDrag(sheetRef, {
    axis: "y",
    enabled: mounted && open,
    claim: (s) => {
      if (ownsDrag(s.target)) return false;
      const root = sheetRef.current!;
      return s.dy > 0 ? !canScroll(s.target, root, "y", -1) : !canScroll(s.target, root, "y", 1);
    },
    onStart: () => {
      run.current?.stop();
      height.current = sheetRef.current?.getBoundingClientRect().height ?? height.current;
      setMoving(true);
    },
    onMove: (s) => y.set(s.dy > 0 ? s.dy : rubberband(s.dy, 48)),
    onEnd: (s) => {
      const landing = projectRelease(Math.max(0, y.get()), s.vy, 0.995);
      if (y.get() > 0 && (landing > height.current * 0.5 || s.vy > 1100)) {
        go(height.current + 24, Math.max(s.vy, 0), () => closeRef.current(), true);
      } else {
        go(0, s.vy);
      }
    },
    onCancel: () => go(0, 0),
  });

  if (!mounted) return null;
  return (
    <div className="mobile-sheet-layer fixed inset-0 z-40" onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }}>
      <motion.div aria-hidden className="absolute inset-0 bg-[rgb(23_24_26/0.34)]" style={{ opacity: scrim }} onClick={onClose} />
      <motion.div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label={label ?? (typeof title === "string" ? title : undefined)}
        tabIndex={-1}
        className={cn(
          "mobile-sheet absolute inset-x-0 bottom-0 flex flex-col overflow-hidden rounded-t-[28px] bg-app outline-none",
          full ? "top-[calc(var(--m-safe-top)+10px)]" : "max-h-[calc(100%-var(--m-safe-top)-10px)]",
        )}
        style={{ y, willChange: moving ? "transform" : undefined }}
      >
        <div aria-hidden className={cn("mx-auto h-[5px] w-9 shrink-0 rounded-full bg-ink/[0.14]", flush ? "pointer-events-none absolute inset-x-0 top-2 z-50" : "mt-2")} />
        {!flush && (
          <div className="flex shrink-0 items-center gap-3 px-4 pb-2 pt-1.5">
            {back
              ? <RoundButton label={t("mobile.sheet.back")} onClick={back} size={40}><ChevronLeft size={20} /></RoundButton>
              : <RoundButton label={t("mobile.sheet.close")} onClick={onClose} size={40}><X size={18} /></RoundButton>}
            <div className="min-w-0 flex-1 truncate text-[15px] font-semibold text-ink">{title}</div>
            {trailing}
          </div>
        )}
        <div ref={bodyRef} className={cn("mobile-sheet-body relative min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[max(var(--m-safe-bottom),16px)]", bodyClassName)}>
          {children}
        </div>
      </motion.div>
    </div>
  );
}
