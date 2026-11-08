import { lazy, useEffect, useId, useLayoutEffect, useRef, type PointerEvent } from "react";
import { MASCOT_INK, type MausState } from "@/lib/mascot";
import { mascotClock } from "@/components/mascot-clock";
import { createMark, hoverGaze, MARK_CANVAS_PERCENT, type Mark, type MarkState } from "@/components/mascot-motion-mark";
import { opticalTransform } from "@/components/mascot-optics";
import { GROK_BODIES } from "../../../shared/grok-bodies";
import type { BotBodyId } from "../../../shared/bot-body";
import type { MausColor } from "../../../shared/wire";

// legacy and halloween bodies need the app's full avatar (zod schemas, carved bodies); every grok body draws the lean mark
const MausAvatar = lazy(() => import("@/components/Avatar").then((m) => ({ default: m.MausAvatar })));
const DEFAULT_LOOK = "tablet";

/** a decorative mark on a web page reads the same at half the app's frame rate, at half the cost */
const PAGE_FPS = 30;
/** the app draws marks under 32 px with an optical fit and larger ones unscaled */
const RAW_MARK_PX = 32;

function LeanMark({ color, look, size, state, live, track }: { color: MausColor; look: string; size: number; state: MausState; live: boolean; track: boolean }) {
  const id = `dm-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const host = useRef<HTMLSpanElement>(null);
  const canvas = useRef<HTMLSpanElement>(null);
  const mark = useRef<Mark | null>(null);
  const options = {
    id, seed: id, body: look, ink: MASCOT_INK[color], state: state as MarkState, sizePx: size, isLive: live, isPlaying: live,
    isEmphasized: false, isReducedMotion: false, maxFrameRate: track ? undefined : PAGE_FPS, hasPersonality: live && size >= RAW_MARK_PX,
  };
  const latest = useRef(options);
  latest.current = options;
  useLayoutEffect(() => {
    if (!canvas.current || !host.current) return;
    const made = createMark(latest.current, { clock: mascotClock(), now: () => performance.now() });
    mark.current = made;
    const detach = made.attach(canvas.current, host.current);
    return () => { detach(); mark.current = null; };
  }, []);
  useEffect(() => { mark.current?.update(options); });
  const onMove = (event: PointerEvent<HTMLSpanElement>) => mark.current?.gaze(hoverGaze(event.currentTarget.getBoundingClientRect(), event.clientX, event.clientY));
  return (
    <span ref={host} onPointerMove={track ? onMove : undefined} onPointerLeave={track ? () => mark.current?.gaze(null) : undefined} style={{ display: "inline-block", position: "relative", width: size, height: size, lineHeight: 0 }}>
      <span ref={canvas} style={{ position: "absolute", left: "50%", top: "50%", width: `${MARK_CANVAS_PERCENT}%`, height: `${MARK_CANVAS_PERCENT}%`, transform: size >= RAW_MARK_PX ? "translate(-50%, -50%)" : opticalTransform(look), pointerEvents: "none" }} />
    </span>
  );
}

interface PageMarkProps { color: MausColor; body: BotBodyId | undefined; size: number; state: MausState; live: boolean; track: boolean }

export default function PageMark({ body, ...props }: PageMarkProps) {
  const look = body === undefined ? DEFAULT_LOOK : Object.hasOwn(GROK_BODIES, body) ? body : null;
  if (look) return <LeanMark look={look} {...props} />;
  return <MausAvatar color={props.color} bodyId={body} size={props.size} state={props.state} animated={props.live} trackPointer={props.track} personality={props.live} />;
}
