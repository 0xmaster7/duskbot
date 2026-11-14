// About me, the profile every bot reads: facts bots learn into it, and lines a person asks a bot to forget.
import { recordGeneralHistory, withoutLearnedFacts } from "./general-memory.ts";
import { appendAboutMe, commitLearned, dropLearnedLines, planLearned } from "./profile-learned.ts";

const LEARNED_PREFIX = /^\s*-\s*\d{4}-\d{2}-\d{2} · learned by [^·\n]* · /;
const BULLET = /^\s*(?:[-*•]|\d+[.)])\s+/;

/** A learned line is judged by its fact, never by the bot that learned it. */
export function withoutMentionedLines(aboutMe: string, mentions: (text: string) => boolean): { text: string; removed: string[] } {
  const removed: string[] = [];
  const kept = aboutMe.split("\n").filter((line) => {
    const fact = line.replace(LEARNED_PREFIX, "").replace(BULLET, "").trim();
    if (!fact || !mentions(fact)) return true;
    removed.push(fact);
    return false;
  });
  return { text: kept.join("\n"), removed };
}

type Plan = (current: string) => { next: string; count: number } | null;

export interface AboutMeDeps {
  read(): string;
  write(text: string): void;
  /** Clients are told after the learned facts are recorded, so a reload sees both. */
  changed(): void;
  today(): string;
  /** A Team Cloud keeps one About me per person, found from the memory layer of their conversation. */
  person?: (layer: string, plan: Plan) => number;
}

export type AboutMe = ReturnType<typeof createAboutMe>;

export function createAboutMe(deps: AboutMeDeps) {
  // `replaces`: older learned facts the new ones change ("lives in Lisbon" when they say they moved to Porto); the newer
  // fact wins and the older line leaves About me, kept in the general memory history off a team.
  const learnPlan = (from: { botId: string; botName: string }, texts: readonly string[], replaces: readonly string[]) => {
    let facts: ReturnType<typeof planLearned> = [];
    let gone: ReturnType<typeof withoutLearnedFacts>["removed"] = [];
    const plan: Plan = (current) => {
      facts = planLearned(from, texts, current, deps.today());
      const appended = appendAboutMe(current, facts.map((fact) => fact.line));
      if (appended === null) return null;
      const replaced = replaces.length ? withoutLearnedFacts(appended, replaces, new Set(facts.map((fact) => fact.line))) : { text: appended, removed: [] };
      gone = replaced.removed;
      return facts.length || gone.length ? { next: replaced.text, count: facts.length } : null;
    };
    return { plan, facts: () => facts, gone: () => gone };
  };
  return {
    learn(from: { botId: string; botName: string }, texts: readonly string[], replaces: readonly string[] = []): number {
      const { plan, facts, gone } = learnPlan(from, texts, replaces);
      if (deps.person) return deps.person(from.botId, plan);
      const planned = plan(deps.read());
      if (!planned) return 0;
      deps.write(planned.next);
      commitLearned(facts());
      const removed = gone();
      if (removed.length) {
        dropLearnedLines(removed.map((entry) => entry.raw));
        recordGeneralHistory(removed.map((entry) => ({ raw: entry.raw, fact: entry.fact, reason: "replaced" as const, ...(texts[0] ? { by: texts.join("; ").slice(0, 300) } : {}) })));
      }
      deps.changed();
      return planned.count;
    },
    /** The facts removed from the About me of the person whose conversation `layer` is. */
    forget(layer: string, mentions: (text: string) => boolean): string[] {
      let removed: string[] = [];
      const plan: Plan = (current) => {
        const kept = withoutMentionedLines(current, mentions);
        removed = kept.removed;
        return kept.removed.length ? { next: kept.text, count: kept.removed.length } : null;
      };
      if (deps.person) {
        deps.person(layer, plan);
        return removed;
      }
      const planned = plan(deps.read());
      if (!planned) return [];
      deps.write(planned.next);
      deps.changed();
      return removed;
    },
  };
}
