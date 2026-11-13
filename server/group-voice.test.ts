import { describe, expect, it } from "vitest";
import { answeredAboveNote, cleanBotVoice, mentionCueNote, roomTalkRules, roomTurnVoiceNote, VOICE_RULES } from "./group-voice.ts";
import { teammatesNote, workInProgressNote } from "./room-team-context.ts";
import { buildMentionNotification } from "./notify.ts";
import { buildSystemPrompt } from "./system-prompt.ts";
import { TALKING_STYLES } from "../shared/talking-style.ts";

const EM = String.fromCharCode(0x2014);
const clean = (text: string, name = "Basil") => cleanBotVoice(text, name).text;

describe("the room's talk rules", () => {
  it("never tells a bot to tag the person as @you, and names them when their name is known", () => {
    const named = roomTalkRules({ person: "Sidd" });
    expect(named).toContain('Talk to Sidd as "you"');
    expect(named).toContain("tag them once as @Sidd");
    expect(named).not.toMatch(/write @you\b/);
    expect(named).toContain('never write "@you"');
    const unnamed = roomTalkRules({});
    expect(unnamed).toContain('the person as "you"');
    expect(unnamed).not.toContain("tag them once");
    expect(roomTalkRules({ person: "Sidd", dm: true })).not.toContain("tag them once");
    for (const rules of [named, unnamed]) {
      expect(rules).not.toContain(EM);
      expect(rules).toContain("Don't repeat what a teammate already said");
      expect(rules).toContain("[reacted 👍 to …]");
    }
  });

  it("reminds every room turn of the voice, and tells a bot answering at once who else is answering", () => {
    const alone = roomTurnVoiceNote({});
    expect(alone).toMatch(/no name prefix, no em dashes, no status-report lines/);
    expect(alone).not.toContain("same time");
    const together = roomTurnVoiceNote({ alsoAnswering: ["Quill", "Echo", "Nova"] });
    expect(together).toContain("Quill, Echo and Nova are answering this same message at the same time");
    expect(together).toContain("speak only for your own part");
    expect(roomTurnVoiceNote({ alsoAnswering: ["Quill"] })).toContain("Quill is answering");
    expect(together).not.toContain(EM);
  });

  it("tells a teammate woken by an @mention to do only its part, and the asker's closing turn to wrap up or pass", () => {
    const handed = mentionCueNote({ by: { name: "Ada" }, closing: false }, "Sidd");
    expect(handed).toContain("Ada @mentioned you just above");
    expect(handed).toContain("not the whole request again");
    expect(handed).toContain("end with @Ada once");
    const closing = mentionCueNote({ by: { name: "Ben" }, closing: true }, "Sidd");
    expect(closing).toContain("last turn on this request");
    expect(closing).toContain("give Sidd one short wrap-up");
    expect(closing).toContain("won't be woken");
    expect(closing).toContain("(pass)");
    expect(answeredAboveNote([])).toBe("");
    expect(answeredAboveNote(["Ada", "Ben"])).toContain("Ada and Ben already answered this message");
    for (const note of [handed, closing, answeredAboveNote(["Ada"])]) expect(note).not.toContain(EM);
    expect(roomTalkRules({})).toContain("write their name without the @");
  });

  it("names what each teammate does and what is already in hand", () => {
    const members = [
      { id: "a", name: "Ada", title: "Project lead" },
      { id: "b", name: "Ben", title: "Researcher", description: "Pulls usage numbers." },
      { id: "c", name: "Cal" },
    ];
    const note = teammatesNote(members, "a");
    expect(note).toContain("- Ben: Researcher: Pulls usage numbers.");
    expect(note).not.toContain("Ada");
    expect(note).not.toContain("Cal");
    expect(teammatesNote([{ id: "c", name: "Cal" }], "a")).toBe("");
    expect(workInProgressNote([])).toBe("");
    expect(workInProgressNote([{ botName: "Ben", task: "Pull last month's\nexport numbers", state: "running" }]))
      .toContain('- Ben (working on it): "Pull last month\'s export numbers"');
  });

  it("rides with the talking style in every turn's prompt, for every style", () => {
    for (const style of TALKING_STYLES) {
      const built = buildSystemPrompt("You are Kiwi.", "", [], undefined, { talkingStyle: style });
      const section = built.sections.find((part) => part.id === "talking-style")!;
      expect(section.text).toContain(VOICE_RULES);
      expect(built.stable).toContain(VOICE_RULES);
    }
    expect(VOICE_RULES).toContain("Never use em dashes");
    expect(VOICE_RULES).toContain("Never start with your own name");
    expect(VOICE_RULES).toContain('Never "@you"');
    expect(VOICE_RULES).not.toContain(EM);
  });
});

describe("the voice safety net on what a bot wrote", () => {
  it("rewrites the screenshot's lines", () => {
    expect(clean(`Basil: No new meal-planning work completed. Next up is dinners, waiting on @you’s preferences.`))
      .toBe("No new meal-planning work completed. Next up is dinners, waiting on your preferences.");
    expect(clean(`My vote's still #1, "Frost, Ember, Pine: the gift glazes are here" @you.`, "Quill"))
      .toBe(`My vote's still #1, "Frost, Ember, Pine: the gift glazes are here".`);
    expect(clean(`the free-shipping test plan is next on my list ${EM} not started yet.\n\nStill the same three things waiting on @you to unblock the team.`, "Nova"))
      .toBe("the free-shipping test plan is next on my list, not started yet.\n\nStill the same three things waiting on you to unblock the team.");
    expect(clean("@you same ask as before: try checkout on your phone.", "Rivet")).toBe("Same ask as before: try checkout on your phone.");
    expect(clean("@you, can you pick one?", "Rivet")).toBe("Can you pick one?");
    expect(clean("Same three things open for @you: the phone test.", "Nova")).toBe("Same three things open for you: the phone test.");
    expect(clean("Want it @you?")).toBe("Want it?");
    expect(clean("Still waiting on @you.")).toBe("Still waiting on you.");
    expect(clean("Thanks @you!")).toBe("Thanks!");
    expect(clean("Thank @you!")).toBe("Thank you!");
  });

  it("reports the person was tagged, so the mention still reaches them", () => {
    expect(cleanBotVoice("Draft is up.\n\n@you three open questions \u2014 Section 2.", "Nova").taggedLine).toBe("Three open questions, Section 2.");
    expect(cleanBotVoice("waiting on @Quill", "Nova").taggedLine).toBeUndefined();
    const store = {
      activePath: () => [{ role: "bot", kind: "text", text: "Waiting on you to test it.", turnId: "t1", from: { botId: "rivet" } }],
      bot: (id: string) => ({ name: id }),
    };
    const room = { id: "g", name: "Standup", memberIds: ["rivet"] };
    const bot = { id: "rivet", name: "Rivet", color: "#000" } as never;
    expect(buildMentionNotification(store, bot, room, { threadId: "th", turnId: "t1", reply: "Waiting on you to test it." })).toBeNull();
    expect(buildMentionNotification(store, bot, room, { threadId: "th", turnId: "t1", reply: "Waiting on you to test it.", tagged: "Waiting on you to test it." })?.body)
      .toBe("Waiting on you to test it.");
  });

  it("strips only the bot's own name prefix and sign-off", () => {
    expect(clean("**Basil:** dinner plan is ready.")).toBe("Dinner plan is ready.");
    expect(clean("Quill: that's Quill's line, not mine.")).toBe("Quill: that's Quill's line, not mine.");
    expect(clean("Done, the plan is in.\n- Basil")).toBe("Done, the plan is in.");
    expect(clean("Basil:")).toBe("Basil:");
  });

  it("turns em dashes into commas, and a dash bullet into a list marker", () => {
    expect(clean(`fix${EM}not started`)).toBe("fix, not started");
    expect(clean(`Hey ${EM}\nnext line`)).toBe("Hey\nnext line");
    expect(clean(`${EM} first\n${EM} second`)).toBe("- first\n- second");
    expect(clean("pages 1–3 and a – b")).toBe("pages 1–3 and a, b");
    expect(clean(`Done. ${EM} next`)).toBe("Done. next");
  });

  it("never touches code, links, emails or teammates' tags", () => {
    const code = "Run this:\n```\necho a — b @you\n```\nand `x — y`.";
    expect(clean(code)).toBe(code);
    expect(clean("See https://example.com/a—b for it.")).toBe("See https://example.com/a—b for it.");
    expect(clean("mail sam@you.com, then ask @Quill and @your-bot.")).toBe("mail sam@you.com, then ask @Quill and @your-bot.");
    expect(clean("Plain words only.")).toBe("Plain words only.");
  });
});
