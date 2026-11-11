import { expect, test } from "vitest";
import { botMood } from "./mood";

const now = 1_800_000_000_000;
const bot = (busy: boolean, idleMs = 60_000) => ({ busy, lastActiveAt: now - idleMs });

test("a bot's mood follows its real status", () => {
  expect(botMood(bot(true), { now })).toBe("working");
  expect(botMood(bot(false), { now })).toBe("idle");
  expect(botMood(bot(false), { now, computer: "asleep" })).toBe("sleeping");
  expect(botMood(bot(false), { now, computer: "starting" })).toBe("waking");
  expect(botMood(bot(false, 2 * 86_400_000), { now })).toBe("drowsy");
  expect(botMood({ busy: false, lastActiveAt: null }, { now })).toBe("idle");
});

test("nobody works on a workspace that cannot be reached", () => {
  expect(botMood(bot(true), { now, freshness: "offline" })).toBe("sleeping");
  expect(botMood(bot(true), { now, freshness: "waiting" })).toBe("sleeping");
  expect(botMood(bot(true), { now, freshness: "recent", computer: "asleep" })).toBe("working");
});
