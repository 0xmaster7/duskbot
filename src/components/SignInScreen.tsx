import { useEffect, useRef, useState } from "react";
import { Loader2 } from "../icons";

import { api } from "@/state/api";
import { t } from "@/lib/i18n";
import { Icon } from "./Icon";

/** How often the card's picture refreshes while it is on screen: a glance at the page, not a live view. */
export const SIGN_IN_SCREEN_MS = 4000;
const RETRY_MS = 10_000;

/** The view-only frame each computer gives, as an image address; null for a place with no picture to show. */
export function signInScreenPath(place: string, botId: string, threadId: string): string | null {
  const suffix = place === "vm" ? "local-computer/screenshot" : place === "cloud" ? "computer/screenshot" : null;
  return suffix ? `/api/bots/${encodeURIComponent(botId)}/${suffix}?threadId=${encodeURIComponent(threadId)}` : null;
}

export function frameAddress(reply: { image?: unknown; png?: unknown; format?: unknown }): string | null {
  if (typeof reply.image === "string" && reply.image) return reply.image;
  if (typeof reply.png === "string" && reply.png.trim()) return `data:${reply.format === "jpeg" ? "image/jpeg" : "image/png"};base64,${reply.png}`;
  return null;
}

/**
 * Grok's take-over card shows the computer's screen: a 16:10 box, reserved before the first frame so nothing below it
 * moves, with the Take over pill over it. The picture refreshes slowly and only while the card is on screen and the
 * page is shown; pressing it takes over, like the card's own button.
 */
export function SignInScreen({ path, name, onOpen, onFrame, disabled, busy }: {
  path: string; name: string; onOpen: () => void;
  /** Each new picture, so the live view that replaces this one can show it until its own first frame. */
  onFrame?: (frame: string) => void;
  disabled?: boolean;
  /** Take over is on its way: the pill holds a spinner. */
  busy?: boolean;
}) {
  const framed = useRef(onFrame);
  framed.current = onFrame;
  const box = useRef<HTMLButtonElement>(null);
  const [frame, setFrame] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const [onScreen, setOnScreen] = useState(false);
  const [shown, setShown] = useState(() => typeof document === "undefined" || document.visibilityState !== "hidden");

  useEffect(() => {
    const node = box.current;
    if (!node || typeof IntersectionObserver !== "function") { setOnScreen(true); return; }
    const watch = new IntersectionObserver(([entry]) => setOnScreen(Boolean(entry?.isIntersecting)));
    watch.observe(node);
    return () => watch.disconnect();
  }, []);

  useEffect(() => {
    const change = () => setShown(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", change);
    return () => document.removeEventListener("visibilitychange", change);
  }, []);

  useEffect(() => {
    if (!onScreen || !shown) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const shoot = async () => {
      let wait = SIGN_IN_SCREEN_MS;
      try {
        const next = frameAddress(await api(path, { method: "POST", background: true, signal: controller.signal, timeoutMs: 60_000 }));
        if (!controller.signal.aborted && next) { setFrame(next); framed.current?.(next); }
      } catch {
        // the last picture stays; a computer that is busy or asleep is asked again later
        wait = RETRY_MS;
      } finally {
        if (!controller.signal.aborted) {
          setTried(true);
          timer = setTimeout(() => void shoot(), wait);
        }
      }
    };
    void shoot();
    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [path, onScreen, shown]);

  return (
    <button
      ref={box}
      type="button"
      onClick={onOpen}
      disabled={disabled}
      aria-label={t("signIn.takeOverComputer")}
      aria-busy={busy || undefined}
      data-sign-in-screen=""
      className="group relative flex aspect-[16/10] w-full items-center justify-center overflow-hidden bg-[#000] text-[13px] leading-[18px] text-[rgb(245_245_245/0.66)] focus-visible:outline-none focus-visible:inset-ring-2 disabled:cursor-default"
    >
      {frame
        ? <img src={frame} alt={t("computer.screenOf", { name })} draggable={false} className="absolute inset-0 size-full object-cover" />
        : tried
          ? <Icon name="device-desktop" size={12} />
          : <span className="flex items-center gap-1.5"><Loader2 size={16} aria-hidden="true" className="motion-safe:animate-spin" />{t("computer.preview.connecting")}</span>}
      {frame && <span aria-hidden="true" className="absolute inset-0 bg-[rgb(0_0_0/0.2)]" />}
      <span aria-hidden="true" className="absolute inset-0 flex items-center justify-center">
        <span className="flex items-center gap-1.5 rounded-full bg-[rgb(0_0_0/0.9)] px-3 py-1.5 text-[12px] font-medium leading-4 text-[#fff]">
          {busy && <Loader2 size={12} aria-hidden="true" className="motion-safe:animate-spin" />}
          {t("signIn.takeOver")}
        </span>
      </span>
    </button>
  );
}
