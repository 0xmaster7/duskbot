import type { BubbleJoin } from "./chat-bubble";

/** A drawn room row, as the layout reads it. */
export interface RoomSlot {
  /** The bubble group the row belongs to ("user", or "bot:" and the bot's id), or null for a card, chip or line. */
  group: string | null;
  /** The bot that sent the row: its run of rows is named once, at the top. */
  sender: string | null;
  /** A time stamp or the unread line stands above the row. */
  stamped: boolean;
}

export interface RoomRowPlace {
  join: BubbleJoin;
  /** The row opens its bot's run: its avatar and name go above it. */
  label: boolean;
  /** A card under its own bot's bubble, or a bubble under its card: 12px apart, not the 16px between speakers. */
  tuck: boolean;
}

/** How a room's rows sit together, as a group chat does: one bot's consecutive bubbles join, its name shows once at the
 * start of its run, and a new speaker or a stamp starts a new run. `null` is a row that draws nothing. */
export function roomRowLayout(slots: readonly (RoomSlot | null)[]): RoomRowPlace[] {
  const places: RoomRowPlace[] = slots.map(() => ({ join: { above: false, below: false }, label: false, tuck: false }));
  let previous: { slot: RoomSlot; index: number } | null = null;
  slots.forEach((slot, index) => {
    if (!slot) return;
    const place = places[index]!;
    const before = previous && !slot.stamped ? previous.slot : null;
    if (before && slot.group && slot.group === before.group) {
      place.join.above = true;
      places[previous!.index]!.join.below = true;
    }
    place.label = Boolean(slot.sender && before?.sender !== slot.sender);
    place.tuck = Boolean(slot.sender && before?.sender === slot.sender && !place.join.above);
    previous = { slot, index };
  });
  return places;
}
