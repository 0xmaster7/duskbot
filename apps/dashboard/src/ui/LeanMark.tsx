import { lazy, useState, type PointerEvent } from "react";
import { MASCOT_INK, type MausState } from "@/lib/mascot";
import { hoverGaze, type MarkGaze } from "@/components/mascot-engine";
import { DuskMark } from "@/components/mascot-view";
import { migrateBodyId } from "../../../../shared/body-migration";
import type { BotBodyId } from "../../../../shared/bot-body";
import type { MausColor } from "../../../../shared/wire";

// halloween bodies need the app's full avatar (zod schemas, carved bodies); every other body draws the lean mark
const MausAvatar = lazy(() => import("@/components/Avatar").then((m) => ({ default: m.MausAvatar })));
const DEFAULT_LOOK = "squircle";

function LeanMark({ color, look, size, state, live, track }: { color: MausColor; look: string; size: number; state: MausState; live: boolean; track: boolean }) {
  const [gaze, setGaze] = useState<MarkGaze | null>(null);
  const onMove = (event: PointerEvent<HTMLSpanElement>) => {
    const next = hoverGaze(event.currentTarget.getBoundingClientRect(), event.clientX, event.clientY);
    setGaze((current) => (current && current.x === next.x && current.y === next.y ? current : next));
  };
  return (
    <span onPointerMove={track ? onMove : undefined} onPointerLeave={track ? () => setGaze(null) : undefined} style={{ display: "inline-flex", width: size, height: size, lineHeight: 0 }}>
      <DuskMark body={look} colour={MASCOT_INK[color]} state={state} size={size} animated={live} gaze={gaze} life={live} />
    </span>
  );
}

interface PageMarkProps { color: MausColor; body: BotBodyId | undefined; size: number; state: MausState; live: boolean; track: boolean }

export default function PageMark({ body, ...props }: PageMarkProps) {
  const look = body === undefined ? DEFAULT_LOOK : migrateBodyId(body);
  if (look) return <LeanMark look={look} {...props} />;
  return <MausAvatar color={props.color} bodyId={body} size={props.size} state={props.state} animated={props.live} trackPointer={props.track} personality={props.live} />;
}
