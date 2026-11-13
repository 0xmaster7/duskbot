// Who speaks next when a bot's room reply @mentions teammates, for one message of the person's. A teammate not yet heard
// from is brought in, up to MENTION_DEPTH steps from the person's message. A bot that handed work to a teammate gets one
// closing turn when that teammate @mentions it back, and a closing turn may only hand back further up, so every bot speaks
// at most twice per message and a tagging loop always ends.

/** Steps of bot-to-bot @mentions away from the person's message that may still bring a new teammate in. */
export const MENTION_DEPTH = 2;

export interface MentionCue {
  /** The teammate whose @mention woke this bot. */
  by: { id: string; name: string };
  /** True for the asker's closing turn: the teammate it handed work to answered it. */
  closing: boolean;
}

export interface NextSpeaker {
  id: string;
  hop: number;
  cue: MentionCue;
}

export class MentionChain {
  /** botId -> the bots that brought it in with an @mention. */
  private askedBy = new Map<string, Set<string>>();
  private closed = new Set<string>();
  private cues = new Map<string, MentionCue>();

  /** The cue for `botId`'s next turn, taken once. */
  takeCue(botId: string): MentionCue | undefined {
    const cue = this.cues.get(botId);
    this.cues.delete(botId);
    return cue;
  }

  closing(botId: string): boolean {
    return this.closed.has(botId);
  }

  /** Whether `id`, @mentioned in `speaker`'s reply, speaks next; asked right before it would run, since an earlier mention
   * in the same reply may have brought it in already. `heard`: bots that already had a turn for this message. */
  decide(speaker: { id: string; name: string }, id: string, hop: number, heard: ReadonlySet<string>, speakerClosing: boolean): NextSpeaker | null {
    if (id === speaker.id) return null;
    const by = { id: speaker.id, name: speaker.name };
    if (this.askedBy.get(speaker.id)?.has(id) === true && heard.has(id) && !this.closed.has(id)) {
      this.closed.add(id);
      return this.cued(id, hop, { by, closing: true });
    }
    if (speakerClosing || heard.has(id) || hop >= MENTION_DEPTH) return null;
    const askers = this.askedBy.get(id) ?? new Set<string>();
    askers.add(speaker.id);
    this.askedBy.set(id, askers);
    return this.cued(id, hop, { by, closing: false });
  }

  private cued(id: string, hop: number, cue: MentionCue): NextSpeaker {
    this.cues.set(id, cue);
    return { id, hop: hop + 1, cue };
  }
}
