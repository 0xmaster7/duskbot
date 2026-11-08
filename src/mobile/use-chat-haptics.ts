import { useEffect, useRef } from "react";
import type { AppState } from "@/state/store";
import { haptic } from "./haptics";

type Last = { id: string; optimistic: boolean; userId: string | null; replied: boolean } | null;

/** The newest row, the person's newest message, and whether a bot has said something in words since it. */
function lastOf(state: AppState, chatId: string | null): Last {
  if (!chatId) return null;
  const owner = state.bots.find((bot) => bot.id === chatId) ?? state.groups.find((group) => group.id === chatId);
  const messages = owner?.messages ?? [];
  const newest = messages.at(-1);
  if (!newest) return null;
  const userIndex = messages.findLastIndex((message) => message.role === "user");
  const replied = messages.slice(userIndex + 1).some((message) => message.role !== "user" && message.kind === "text" && Boolean(message.text?.trim()));
  return { id: newest.id, optimistic: newest.role === "user" && newest.id.startsWith("optimistic-"), userId: userIndex >= 0 ? messages[userIndex]!.id : null, replied };
}

/** The taps a hand expects from a chat: a light one as a message leaves, a soft one as the reply lands in the open chat,
 * an error buzz when something fails, and a selection tick on any switch. */
export function useChatHaptics(state: AppState, chatId: string | null) {
  const last = useRef<Last>(null);
  const shownChat = useRef<string | null>(null);
  const error = useRef<string | null>(null);

  useEffect(() => {
    const next = lastOf(state, chatId);
    const prev = last.current;
    last.current = next;
    if (shownChat.current !== chatId) { shownChat.current = chatId; return; }
    if (!next || next.id === prev?.id) return;
    if (next.optimistic) haptic("light");
    else if (next.replied && !(prev?.replied && prev.userId === next.userId)) haptic("soft");
  }, [state, chatId]);

  useEffect(() => {
    if (state.error && state.error !== error.current) haptic("error");
    error.current = state.error;
  }, [state.error]);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest("[role='switch'], input[type='checkbox']")) haptic("selection");
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);
}
