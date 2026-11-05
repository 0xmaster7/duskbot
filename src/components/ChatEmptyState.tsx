import type { Bot } from "@/state/store";

/** A chat with no messages yet is empty, as Grok Bot's is: the header's pill and the message box say whose chat it is.
 * Only a screen reader hears that nothing has been said. */
export function EmptyChat({ bot }: { bot: Bot }) {
  return (
    <div className="flex flex-1" data-empty-chat={bot.id}>
      <span role="status" className="sr-only">No messages yet</span>
    </div>
  );
}
