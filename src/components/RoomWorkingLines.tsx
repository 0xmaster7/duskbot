import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useRef, useState } from "react";

import { friendlyNowPhrases } from "@/lib/friendly-activity";
import { EASE_OUT, REDUCED } from "@/lib/motion-presets";
import type { Bot, Group, Message } from "@/state/store";
import { BotAvatar } from "./Avatar";
import type { MarkState } from "./mascot-motion-mark";
import { TurnPresence } from "./TurnPresence";

/** Grok's status row. */
const LINE_PX = 36;
/** Grok's status line leaves in 140ms and grows in over 180ms. */
const ENTER = { duration: 0.18, ease: EASE_OUT };
const LEAVE = { duration: 0.14, ease: EASE_OUT };

type RoomWork = Pick<Group, "busyBotId" | "threadId" | "tasks"> & { busyBotIds?: readonly string[] | null };

/** Every member running a turn in the room's open thread, speaker first: the busy speaker, each member a parallel turn
 * reports, and a member whose tool call is still out. */
export function roomWorkingIds(group: RoomWork, lastMessage: Message | undefined): string[] {
  const task = group.tasks?.find((candidate) => candidate.threadId === group.threadId);
  const inFlight = lastMessage?.kind === "activity" && lastMessage.tool && lastMessage.tool.ok === undefined ? lastMessage.from?.botId : undefined;
  const ids = [group.busyBotId, task?.busyBotId, ...(group.busyBotIds ?? []), inFlight];
  return [...new Set(ids.filter((id): id is string => typeof id === "string" && id.length > 0))];
}

/** Bots working alongside the speaker each say a different one of the working phrases. */
function sidePhrase(index: number): { phrases: string[]; phase: string } {
  const pool = friendlyNowPhrases(null);
  return { phrases: [pool.phrases[index % pool.phrases.length]!], phase: `${pool.phase}:${index}` };
}

/** Ids in the order they first showed up, so a line never trades places with another while both work. */
function useArrivalOrder(ids: readonly string[]): string[] {
  const order = useRef<string[]>([]);
  const kept = order.current.filter((id) => ids.includes(id));
  const next = [...kept, ...ids.filter((id) => !kept.includes(id))];
  if (next.length !== order.current.length || next.some((id, index) => id !== order.current[index])) order.current = next;
  return order.current;
}

export interface RoomSpeakerLine {
  bot: Bot | undefined;
  visible: boolean;
  markState: MarkState;
  phrases?: readonly string[];
  phase?: string;
  since: number | null;
}

/** The room's live status lines under the transcript, one quiet line per working bot like the sidebar's working rows:
 * its mark at work, its name and a friendly phrase. The speaker's phrase follows the thread's live step; a bot working
 * alongside it says one of the working phrases. The first line sits in the slot the room keeps at its end, a row's gap
 * under whichever bubble is last, so it never moves a row; each further one grows in under it and folds away when that
 * bot is done. */
export function RoomWorkingLines({ group, members, workingIds, speaker, slot }: {
  group: Pick<Group, "id" | "turnStartedAt">;
  members: readonly Bot[];
  workingIds: readonly string[];
  speaker: RoomSpeakerLine;
  slot: boolean;
}) {
  const reduce = useReducedMotion();
  const speakerId = speaker.bot?.id;
  const ids = [...(speaker.visible && speakerId ? [speakerId] : []), ...workingIds.filter((id) => id !== speakerId)]
    .filter((id) => members.some((member) => member.id === id));
  const ordered = useArrivalOrder(ids);
  return (
    <div className={slot ? "turn-status-slot flex min-h-9 shrink-0 flex-col" : "contents"} data-room-working-lines="">
      <AnimatePresence initial={false}>
        {ordered.map((id, index) => {
          const bot = members.find((member) => member.id === id)!;
          const isSpeaker = id === speakerId;
          const words = isSpeaker ? speaker : sidePhrase(index);
          return (
            <motion.div
              key={id}
              data-room-working-line={bot.name}
              className="shrink-0 overflow-visible"
              style={{ transformOrigin: `0 ${LINE_PX / 2}px` }}
              initial={{ height: 0 }}
              animate={{ height: LINE_PX, opacity: 1, scale: 1 }}
              exit={reduce ? { height: 0, opacity: 0 } : { height: 0, opacity: 0, scale: 0.92 }}
              transition={reduce ? { height: { duration: 0 }, opacity: REDUCED } : { height: ENTER, default: LEAVE }}
            >
              <WorkingLine
                named={ordered.length > 1}
                bot={bot}
                state={isSpeaker ? speaker.markState : "working"}
                phrases={words.phrases}
                phase={words.phase}
                since={isSpeaker ? speaker.since : null}
                seed={`${group.id}:${group.turnStartedAt ?? ""}:${id}`}
              />
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

function WorkingLine({ bot, named, state, phrases, phase, since, seed }: {
  bot: Bot;
  named: boolean;
  state: MarkState;
  phrases?: readonly string[];
  phase?: string;
  since: number | null;
  seed: string;
}) {
  const [emphasized, setEmphasized] = useState(false);
  return (
    <div onMouseEnter={() => setEmphasized(true)} onMouseLeave={() => setEmphasized(false)}>
      <TurnPresence
        avatar={
          <BotAvatar
            bot={bot}
            state={state}
            size={28}
            eyeInk="var(--color-app)"
            emphasized={emphasized}
            forward={false}
            lookAround={1}
            trackPointer={false}
          />
        }
        simple
        visible
        // one bot keeps the plain 1:1 line; names only tell several apart
        name={named ? bot.name : undefined}
        phrases={phrases}
        phase={phase}
        seed={seed}
        since={since}
      />
    </div>
  );
}
