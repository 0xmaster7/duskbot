// Cards of features that are gone (lending a computer to a Cloud: its "turn on your computer" asks and its lifts) may
// still sit open in old conversations. Nothing answers them any more, so they are closed at startup.
import { optionCardsForTools } from "./message-db.ts";
import type { Store } from "./store.ts";

const RETIRED_TOOLS = ["turn_on_your_computer", "lending_lift"];

export function dismissRetiredCards(store: Store): number {
  let dismissed = 0;
  for (const { threadId, messageId } of optionCardsForTools(RETIRED_TOOLS)) {
    const card = store.messagesFor(threadId).find((message) => message.id === messageId)?.card;
    if (!card || card.answered || card.dismissed || card.expired || card.stopped) continue;
    if (store.patchMessage(threadId, messageId, { card: { ...card, answered: "deny", dismissed: true } })) dismissed += 1;
  }
  return dismissed;
}
