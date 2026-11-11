import { forwardRef, useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState, type CSSProperties } from "react";

import { BODIES, INK, bodyName, botSvg } from "../../electron/mascot-geometry.mjs";
import { EXPRESSION_FACES, createMark, markFace, type Mark, type MarkGaze, type MarkPoke, type MarkReaction } from "./mascot-engine";
import { onMascotCue } from "./mascot-events";
import { ATTENTION, attentionGaze, watchPointer } from "./mascot-attention";

const useClientLayoutEffect = typeof document === "undefined" ? useEffect : useLayoutEffect;

/** How long a mark keeps looking at the composer after the last keystroke. */
const WATCH_MS = 1400;
const COMPOSER_GAZE = { x: 0.15, y: 0.75 };
const EMPHASIS_GAZE = { x: 0, y: -0.6 };

export interface DuskMarkProps {
  /** One of our bodies; anything else draws the circle. */
  body: string;
  /** CSS paint for the body. */
  colour: string;
  /** CSS paint for the eyes and mouth. */
  eyes?: string;
  state?: string;
  size?: number;
  /** False draws the state's resting pose once and never moves. */
  animated?: boolean;
  /** A resting mark looks up, surprised, while the pointer is on it. */
  emphasized?: boolean;
  /** Where the mark looks, -1..1 on each axis with y down; null looks about on its own. */
  gaze?: MarkGaze | null;
  /** Face index from the older expression list, held until it changes. */
  expression?: number;
  label?: string | null;
  /** False: no blinks, idle glances or noticing the pointer between turns. */
  life?: boolean;
  /** The bot whose app moments (a message typed, a chat opened) this mark answers. */
  cueKey?: string;
  className?: string;
  style?: CSSProperties;
}

export interface DuskMarkHandle {
  blink: () => void;
  spin: (durationMs?: number) => void;
  setExpression: (index: number) => void;
  /** No kind cycles spin, bounce and nod. */
  poke: (kind?: MarkPoke) => void;
  react: (kind: MarkReaction) => void;
}

const expressionFace = (index: number) => EXPRESSION_FACES[((index % EXPRESSION_FACES.length) + EXPRESSION_FACES.length) % EXPRESSION_FACES.length]!;

export const DuskMark = forwardRef<DuskMarkHandle, DuskMarkProps>(function DuskMark(props, ref) {
  const shape = bodyName(props.body);
  return <MarkSvg key={shape} ref={ref} {...props} body={shape} />;
});

const MarkSvg = forwardRef<DuskMarkHandle, DuskMarkProps>(function MarkSvg(
  { body, colour, eyes, state = "idle", size = 44, animated = true, emphasized = false, gaze = null, expression, label, life = true, cueKey, className, style },
  ref,
) {
  const svg = useRef<SVGSVGElement>(null);
  const mark = useRef<Mark | null>(null);
  const [held, setHeld] = useState<string | null>(null);
  const emphasisFace = emphasized && state === "idle" ? "surprised" : null;
  const face = held ?? (expression === undefined ? emphasisFace : expressionFace(expression));
  // the markup is written once per body; the engine moves it from there
  const [html] = useState(() => botSvg(body, face ?? markFace(state), eyes || INK));
  const latest = useRef({ colour, eyes, state, size, animated, life, face });
  latest.current = { colour, eyes, state, size, animated, life, face };

  const look = useRef<{ gaze: MarkGaze | null; attention: MarkGaze | null; watching: boolean; emphasized: boolean }>({ gaze, attention: null, watching: false, emphasized });
  const applyLook = () => {
    const s = look.current;
    const at = s.watching ? COMPOSER_GAZE : s.gaze ?? s.attention ?? (s.emphasized ? EMPHASIS_GAZE : null);
    mark.current?.lookAt(at ? at.x : null, at?.y);
  };

  useClientLayoutEffect(() => {
    const p = latest.current;
    const made = createMark(svg.current!, { body, colour: p.colour, eyes: p.eyes, state: p.state, size: p.size, still: p.animated ? undefined : true, life: p.life });
    if (p.face) made.hold(p.face);
    mark.current = made;
    applyLook();
    return () => { made.destroy(); mark.current = null; };
  }, []);

  useEffect(() => { mark.current?.setState(state); }, [state]);
  useEffect(() => { mark.current?.setColour(colour); }, [colour]);
  useEffect(() => { mark.current?.setEyes(eyes); }, [eyes]);
  useEffect(() => { mark.current?.setStill(animated ? undefined : true); }, [animated]);
  useEffect(() => { mark.current?.setLife(life); }, [life]);
  useEffect(() => { mark.current?.setSize(size); }, [size]);
  useEffect(() => { mark.current?.hold(face); }, [face]);
  useEffect(() => {
    look.current.gaze = gaze;
    look.current.emphasized = emphasized;
    applyLook();
  }, [gaze?.x, gaze?.y, gaze === null, emphasized]);

  useEffect(() => {
    if (!cueKey) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = onMascotCue(cueKey, (cue) => {
      if (cue !== "watch") return mark.current?.react(cue);
      clearTimeout(timer);
      look.current.watching = true;
      applyLook();
      timer = setTimeout(() => { look.current.watching = false; applyLook(); }, WATCH_MS);
    });
    return () => { off(); clearTimeout(timer); look.current.watching = false; };
  }, [cueKey]);

  // a big mark notices a mouse moving near it, then loses interest once the pointer rests
  const attentive = animated && life && size >= ATTENTION.minPx;
  useEffect(() => {
    if (!attentive) return;
    let rect: DOMRect | null = null, rectAt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const set = (next: MarkGaze | null) => { look.current.attention = next; applyLook(); };
    const stop = watchPointer((point) => {
      clearTimeout(timer);
      if (!point) return set(null);
      const now = performance.now();
      if (!rect || now - rectAt > ATTENTION.rectMs) { rect = svg.current?.getBoundingClientRect() ?? null; rectAt = now; }
      const next = rect ? attentionGaze(rect, point) : null;
      set(next);
      if (next) timer = setTimeout(() => set(null), ATTENTION.holdMs);
    });
    return () => { stop(); clearTimeout(timer); look.current.attention = null; };
  }, [attentive]);

  useImperativeHandle(ref, () => ({
    blink: () => mark.current?.blink(),
    spin: () => mark.current?.react("spin"),
    setExpression: (index: number) => setHeld(expressionFace(index)),
    poke: (kind?: MarkPoke) => mark.current?.poke(kind),
    react: (kind: MarkReaction) => mark.current?.react(kind),
  }), []);

  return (
    <svg
      ref={svg}
      viewBox="0 0 100 100"
      width={size}
      height={size}
      overflow="visible"
      data-dusk-mark=""
      data-body={body}
      data-state={state}
      role={label ? "img" : undefined}
      aria-label={label || undefined}
      aria-hidden={label ? undefined : true}
      className={className}
      style={{ width: size, height: size, color: colour, flexShrink: 0, ...style }}
      onDoubleClick={animated ? () => mark.current?.react("tap") : undefined}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
});

/** A 1px ring that follows a body's outline 3px out, for a picker's hovered or chosen shape. */
export function BodyRing({ body, size, className }: { body: string; size: number; className?: string }) {
  const id = `ring-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const d = BODIES[bodyName(body)].d;
  const unit = 100 / size;
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 100 100" overflow="visible" className={className}>
      <mask id={id} maskUnits="userSpaceOnUse" x={-100} y={-100} width={300} height={300}>
        <path d={d} fill="#fff" stroke="#fff" strokeWidth={8 * unit} strokeLinejoin="round" />
        <path d={d} fill="#000" stroke="#000" strokeWidth={6 * unit} strokeLinejoin="round" />
      </mask>
      <rect x={-100} y={-100} width={300} height={300} fill="currentColor" mask={`url(#${id})`} />
    </svg>
  );
}
