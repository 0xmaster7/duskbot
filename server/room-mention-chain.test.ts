import { describe, expect, it } from "vitest";

import { MENTION_DEPTH, MentionChain } from "./room-mention-chain.ts";

const ada = { id: "ada", name: "Ada" }, ben = { id: "ben", name: "Ben" }, cal = { id: "cal", name: "Cal" };

describe("who a bot's @mention wakes in a room", () => {
  it("brings a new teammate in, then gives the asker one closing turn when the teammate tags it back", () => {
    const chain = new MentionChain();
    const heard = new Set(["ada"]);
    expect(chain.decide(ada, "ben", 0, heard, false)).toEqual({ id: "ben", hop: 1, cue: { by: ada, closing: false } });
    expect(chain.takeCue("ben")).toEqual({ by: ada, closing: false });
    heard.add("ben");
    expect(chain.decide(ben, "ada", 1, heard, false)).toEqual({ id: "ada", hop: 2, cue: { by: ben, closing: true } });
    expect(chain.closing("ada")).toBe(true);
    // the closing turn only answers: tagging Ben again wakes nobody
    expect(chain.decide(ada, "ben", 2, heard, true)).toBeNull();
  });

  it("never wakes a bot that already spoke unless it handed that work out, and only once", () => {
    const chain = new MentionChain();
    const heard = new Set(["ada", "ben"]);
    expect(chain.decide(ada, "ben", 0, heard, false)).toBeNull();
    expect(chain.decide(ben, "ada", 0, heard, false)).toBeNull();
    const fresh = new MentionChain();
    expect(fresh.decide(ada, "ben", 0, new Set(["ada"]), false)).not.toBeNull();
    expect(fresh.decide(ben, "ada", 1, new Set(["ada", "ben"]), false)?.cue.closing).toBe(true);
    expect(fresh.decide(ben, "ada", 1, new Set(["ada", "ben"]), false)).toBeNull();
  });

  it("stops bringing new teammates in past the depth limit, and hands back up the chain", () => {
    const chain = new MentionChain();
    const heard = new Set(["ada"]);
    expect(chain.decide(ada, "ben", 0, heard, false)?.hop).toBe(1);
    heard.add("ben");
    expect(chain.decide(ben, "cal", 1, heard, false)?.hop).toBe(MENTION_DEPTH);
    heard.add("cal");
    expect(chain.decide(cal, "dee", MENTION_DEPTH, heard, false)).toBeNull();
    // Cal hands back to Ben, whose closing turn may hand back to Ada
    expect(chain.decide(cal, "ben", 2, heard, false)?.cue.closing).toBe(true);
    expect(chain.decide(ben, "ada", 3, heard, true)?.cue).toEqual({ by: ben, closing: true });
  });

  it("ends any tagging loop with each bot speaking at most twice", () => {
    const chain = new MentionChain();
    const bots = [ada, ben, cal];
    const heard = new Set<string>();
    const turns: string[] = [];
    const speak = (bot: typeof ada, hop: number, closing: boolean) => {
      heard.add(bot.id);
      turns.push(bot.id);
      for (const other of bots) {
        const next = chain.decide(bot, other.id, hop, heard, closing);
        if (next) speak(bots.find((b) => b.id === next.id)!, next.hop, next.cue.closing);
      }
    };
    speak(ada, 0, false);
    expect(turns.length).toBeLessThanOrEqual(6);
    for (const bot of bots) expect(turns.filter((id) => id === bot.id).length).toBeLessThanOrEqual(2);
  });
});
