import { useEffect, useRef } from "react";
import { warmChatImages, type MediaSize } from "@/lib/image-cache";

type Chat = { messages?: ReadonlyArray<{ media?: Record<string, MediaSize> }> };

const WARM_CHATS = 8;
const WARM_PER_CHAT = 6;

/** The pictures of the chats this device already holds, fetched and decoded at idle, so opening one paints them at once. */
export function useWarmChatImages(chats: ReadonlyArray<Chat>): void {
  const picked = chats.filter((chat) => chat.messages?.some((message) => message.media)).slice(0, WARM_CHATS);
  const latest = useRef(picked);
  latest.current = picked;
  const signature = picked.map((chat) => Object.keys(chat.messages?.findLast((message) => message.media)?.media ?? {}).join(",")).join("|");
  useEffect(() => {
    if (signature) for (const chat of latest.current) warmChatImages(chat.messages ?? [], WARM_PER_CHAT);
  }, [signature]);
}
