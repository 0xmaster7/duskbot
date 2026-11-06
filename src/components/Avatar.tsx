import {
  forwardRef,
  memo,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { cn } from "@/lib/cn";
import { MASCOT_INK, MAUS_STATES, type MausColor, type MausMotion, type MausState } from "@/lib/mascot";
import type { CursorAvatarHandle, CursorState } from "./CursorAvatar";
import { GrokMark, type GrokMarkHandle } from "./mascot-motion-view";
import { hoverGaze, type MarkState } from "./mascot-motion-mark";
import type { MarkReaction } from "./mascot-personality";
import { avatarCropRadius, botAvatarProfile, clampAvatarFocus, clampAvatarZoom, mascotFaceInk, type BotAvatarCrop, type MascotFaceColor } from "../../shared/bot-avatar";
import { grokBodyFor, isHalloweenBody, type BotBodyId } from "../../shared/bot-body";
import { useHalloweenDressed, wornBody } from "@/lib/halloween-dress";
import { CarvedAvatar } from "./CarvedAvatar";

export const EYE_SCALE = 1.12;
export const MOUTH_WEIGHT = 11;

interface MotionFaces
  extends Partial<
    Record<Exclude<MausMotion, "none">, { state?: MausState; blink?: boolean; spin?: number; react?: MarkReaction }>
  > {}

const MOTION_FACE: MotionFaces = {
  arrive: { state: "spawning", spin: 900 },
  switch: { react: "open" },
  customize: { state: "proud", blink: true },
  alert: { state: "alerting" },
  thinking: { state: "thinking" },
  working: { state: "working" },
  launch: { state: "loading" },
  success: { state: "happy", blink: true },
  celebrate: { state: "celebrate", spin: 700 },
  blink: { blink: true },
  surprise: { state: "surprised", blink: true },
  failure: { state: "sad" },
};

const MOTION_FACE_MS = 1400;

// grok marks are one flat ink, no shading; a readable gradient paints with its middle stop
const inkFor = (color: MausColor, gradient?: [string, string, string]): string => gradient?.[1] ?? MASCOT_INK[color] ?? MASCOT_INK.green;

export function roomAvatarGradient(color: MausColor): [string, string, string] {
  const fill = `var(--identity-${color})`;
  return [
    `color-mix(in srgb, ${fill} 82%, #ffffff)`,
    fill,
    `color-mix(in srgb, ${fill} 82%, #000000)`,
  ];
}

export type MausAvatarHandle = CursorAvatarHandle & Partial<Pick<GrokMarkHandle, "poke" | "react">>;

export type MausAvatarProps = {
  color: MausColor;
  /** Any of Grok's mark states: idle rests still, working and the other busy states play Grok's clips. */
  state?: MausState;
  /** Grok's isEmphasized: a resting face looks up, surprised, while the pointer is on the status line. */
  emphasized?: boolean;
  /** CSS paint for the eyes, over the bot's face colour: Grok's status line paints them var(--sand-bg-chrome). */
  eyeInk?: string;
  expression?: number;
  size?: number;
  label?: string;
  motion?: MausMotion;
  motionKey?: number;
  turn?: number;
  gaze?: { x?: number; y?: number };
  spring?: number;
  eyeScale?: number;
  showMouth?: boolean;
  mouthStroke?: number;
  forward?: boolean;
  lookAround?: number;
  trackPointer?: boolean;
  animated?: boolean;
  bodyId?: BotBodyId;
  gradient?: [string, string, string];
  faceColor?: MascotFaceColor | null;
  /** The bot whose app moments this mark answers (see mascot-events). */
  cueKey?: string;
  /** False keeps Grok's still idle between turns. */
  personality?: boolean;
};

// the carved halloween bodies keep the older engine, which names fewer states
const CARVED_STATE: Partial<Record<MarkState, CursorState>> = {
  streaming: "writing", reading: "searching", coding: "working", running: "working", computing: "working",
  controlling: "working", waiting: "orbit", blocked: "curious", finished: "happy", failed: "sad", approving: "happy",
};
const carvedState = (state: MausState | undefined): CursorState | undefined =>
  state === undefined ? undefined : (CARVED_STATE[state as MarkState] ?? (MAUS_STATES.includes(state as CursorState) ? (state as CursorState) : "idle"));

function MausAvatarComponent(props: MausAvatarProps, ref: React.Ref<MausAvatarHandle>) {
  const { bodyId, color, size, state, motion, motionKey, gaze, trackPointer, animated, label } = props;
  if (isHalloweenBody(bodyId)) {
    return (
      <CarvedAvatar
        ref={ref}
        body={bodyId}
        color={color}
        faceColor={props.faceColor}
        size={size}
        state={carvedState(state)}
        motion={motion}
        motionKey={motionKey}
        gaze={gaze}
        trackPointer={trackPointer}
        animated={animated}
        label={label}
      />
    );
  }
  return <GradientAvatar ref={ref} {...props} />;
}

function GradientAvatarComponent(
  {
    color,
    state = "idle",
    emphasized,
    eyeInk,
    expression,
    size = 44,
    label,
    motion = "none",
    motionKey = 0,
    gaze,
    trackPointer = true,
    animated = true,
    bodyId,
    gradient,
    faceColor,
    cueKey,
    personality,
  }: MausAvatarProps,
  ref: React.Ref<MausAvatarHandle>,
) {
  const faceInk = mascotFaceInk(faceColor);
  const inner = useRef<GrokMarkHandle>(null);
  useImperativeHandle(ref, () => ({
    blink: () => inner.current?.blink(),
    spin: (durationMs?: number) => inner.current?.spin(durationMs),
    setExpression: (index: number) => inner.current?.setExpression(index),
    poke: (kind) => inner.current?.poke(kind),
    react: (kind) => inner.current?.react(kind),
  }));

  const [motionState, setMotionState] = useState<MausState | null>(null);
  useEffect(() => {
    if (motion === "none" || !animated) return;
    const beat = MOTION_FACE[motion];
    if (!beat) return;
    if (beat.blink) inner.current?.blink();
    if (beat.spin) inner.current?.spin(beat.spin);
    if (beat.react) inner.current?.react(beat.react);
    if (!beat.state) return;
    setMotionState(beat.state);
    const timer = setTimeout(() => setMotionState(null), MOTION_FACE_MS);
    return () => clearTimeout(timer);
  }, [motion, motionKey, animated]);

  // grok's attachMarkHoverGaze: the body turns toward a pointer on it, full turn half a mark from its centre
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  const tracking = trackPointer && animated;
  const onPointerMove = (event: ReactPointerEvent<HTMLSpanElement>) => {
    const next = hoverGaze(event.currentTarget.getBoundingClientRect(), event.clientX, event.clientY);
    setPointer((current) => (current && current.x === next.x && current.y === next.y ? current : next));
  };
  const onPointerLeave = () => setPointer(null);
  const look = pointer ?? (gaze ? { x: gaze.x ?? 0, y: gaze.y ?? 0 } : null);

  return (
    <span
      className="inline-flex shrink-0"
      onPointerMove={tracking ? onPointerMove : undefined}
      onPointerLeave={tracking ? onPointerLeave : undefined}
    >
      <GrokMark
        ref={inner}
        body={grokBodyFor(bodyId)}
        ink={inkFor(color, gradient)}
        eye={eyeInk ?? faceInk ?? undefined}
        state={motionState ?? state}
        emphasized={emphasized}
        expression={expression}
        size={size}
        animated={animated}
        gaze={look}
        seed={label ?? undefined}
        label={label ?? null}
        cueKey={cueKey}
        personality={personality}
      />
    </span>
  );
}

const GradientAvatar = forwardRef(GradientAvatarComponent);

export const MausAvatar = memo(forwardRef(MausAvatarComponent));

export type BotAvatarProps = Omit<MausAvatarProps, "color" | "gradient"> & {
  readable?: boolean;
  bot: {
    id?: string;
    name?: string;
    color: MausColor;
    avatarUrl?: string | null;
    avatarCrop?: BotAvatarCrop;
    avatarZoom?: number;
    avatarFocusX?: number;
    avatarFocusY?: number;
    mascotBody?: BotBodyId | null;
    mascotFaceColor?: MascotFaceColor | null;
  };
};

export type BotAvatarOutcome = "flatImage" | "gradientMascot";

/** Mirrored name for name by resolveBotAvatarOutcome in ios/Sources/CompanionCore/BotAvatarRendering.swift. */
export function resolveBotAvatarOutcome(params: {
  avatarCrop: BotAvatarCrop;
  hasUrl: boolean;
  imageFailed: boolean;
}): BotAvatarOutcome {
  const { avatarCrop, hasUrl, imageFailed } = params;
  if (!hasUrl) return "gradientMascot";
  if (avatarCrop === "mascot") return "gradientMascot";
  if (imageFailed) return "gradientMascot";
  return "flatImage";
}

export function BotAvatar({ bot, size = 44, label, readable = false, ...mascotProps }: BotAvatarProps) {
  const profile = botAvatarProfile(bot);
  const dressed = useHalloweenDressed();
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => setImageFailed(false), [profile.avatarUrl]);

  const outcome = resolveBotAvatarOutcome({
    avatarCrop: profile.avatarCrop,
    hasUrl: Boolean(profile.avatarUrl),
    imageFailed,
  });

  if (outcome !== "flatImage") {
    return (
      <MausAvatar
        bodyId={wornBody(bot.mascotBody, bot.color, dressed)}
        {...mascotProps}
        color={bot.color}
        faceColor={bot.mascotFaceColor}
        gradient={readable ? roomAvatarGradient(bot.color) : undefined}
        size={size}
        label={label ?? bot.name}
        cueKey={mascotProps.cueKey ?? bot.id}
      />
    );
  }

  const radius = avatarCropRadius(profile.avatarCrop);
  const zoom = clampAvatarZoom(bot.avatarZoom ?? 1);
  const focusX = clampAvatarFocus(bot.avatarFocusX ?? 0.5);
  const focusY = clampAvatarFocus(bot.avatarFocusY ?? 0.5);
  const origin = `${focusX * 100}% ${focusY * 100}%`;
  return (
    <span
      className="relative block shrink-0 overflow-hidden bg-raised"
      style={{ width: size, height: size, borderRadius: radius }}
    >
      <img
        src={profile.avatarUrl}
        alt={label ?? (bot.name ? `${bot.name} avatar` : "Bot avatar")}
        width={size}
        height={size}
        draggable={false}
        onError={() => setImageFailed(true)}
        className="block size-full max-w-none object-cover"
        style={{
          width: size,
          height: size,
          objectPosition: origin,
          transform: zoom === 1 ? undefined : `scale(${zoom})`,
          transformOrigin: origin,
        }}
      />
    </span>
  );
}

export function InitialsAvatar({
  initials,
  avatarUrl,
  size = 32,
  fallback,
  fontSize,
  className,
}: {
  initials: string;
  avatarUrl?: string;
  size?: number;
  className?: string;
  /** drawn instead of the initials, for a person with no name or email to take them from */
  fallback?: ReactNode;
  fontSize?: number;
}) {
  // A picture that is gone (a restored backup carries the address, not the file) falls back to the initials.
  const [failed, setFailed] = useState<string | null>(null);
  if (avatarUrl && failed !== avatarUrl) {
    return <img src={avatarUrl} alt="" onError={() => setFailed(avatarUrl)} className={cn("shrink-0 rounded-full object-cover", className)} style={{ width: size, height: size }} />;
  }
  return (
    <div
      className={cn("flex shrink-0 items-center justify-center rounded-full bg-raised text-ink-secondary font-medium", className)}
      style={{ width: size, height: size, fontSize: fontSize ?? size * 0.38 }}
    >
      {fallback ?? initials}
    </div>
  );
}
