import { afterEach, describe, expect, it } from "vitest";
import type { Bot, Message } from "@/state/store";
import { noteTurnEvent, resetTurnLive, turnLive } from "@/state/turn-status";
import { ambientBot, ambientSnapshot } from "./summary";

let at = 0;
const message = (fields: Partial<Message>): Message => ({ id: `m${++at}`, at, role: "bot", kind: "text", ...fields }) as Message;
const bot = (fields: Partial<Bot> = {}): Bot => ({ id: "nova", name: "Nova", color: "blue", threadId: "t1", messages: [], busy: false, unread: false, ...fields }) as unknown as Bot;
const approval = (fields: Record<string, unknown> = {}) => message({ kind: "options", card: { title: "Run a command", subtitle: "npm test", options: ["Allow", "Deny"], requestId: "r1", tool: "Bash", requestType: "permission", ...fields } } as Partial<Message>);

afterEach(() => resetTurnLive());

describe("the summary the island and the dock draw", () => {
  it("says what a running turn is doing, from the live stream", () => {
    const busy = bot({ busy: true, messages: [message({ role: "user", text: "Fix the footer" })] });
    expect(ambientBot(busy, [], turnLive).status).toBe("working");
    noteTurnEvent({ type: "content.delta", threadId: "t1", turnId: "u1", streamKind: "reasoning_text", delta: "" } as never);
    expect(ambientBot(busy, [], turnLive)).toMatchObject({ status: "thinking", detail: "Thinking" });
    noteTurnEvent({ type: "content.delta", threadId: "t1", turnId: "u1", streamKind: "assistant_text", delta: "On it" } as never);
    expect(ambientBot(busy, [], turnLive).status).toBe("talking");
  });

  it("offers a plain approval in place and leaves a proposal to its own card", () => {
    const asking = ambientBot(bot({ messages: [approval()] }), [], turnLive);
    expect(asking).toMatchObject({ status: "needs-you", asks: 1, approval: { requestId: "r1", threadId: "t1", title: "npm test" } });
    expect(asking.detail).toMatch(/^Wants to /);
    const proposal = ambientBot(bot({ messages: [approval({ skillRequest: { action: "enable", name: "x" } })] }), [], turnLive);
    expect(proposal).toMatchObject({ status: "needs-you", approval: null });
    const answered = ambientBot(bot({ messages: [approval({ answered: "Allow" })] }), [], turnLive);
    expect(answered.status).not.toBe("needs-you");
    expect(ambientBot(bot({ activity: "waiting-on-you" }), [], turnLive).status).toBe("needs-you");
  });

  it("offers a one-tap question's choices in place, ahead of an approval, and only opens a longer one", () => {
    const question = (fields: Record<string, unknown> = {}) => message({ kind: "options", card: { title: "Which branch?", subtitle: "", options: ["main", "dev"], requestId: "q1", requestType: "question", ...fields } } as Partial<Message>);
    const asking = ambientBot(bot({ messages: [approval(), question()] }), [], turnLive);
    expect(asking).toMatchObject({ status: "needs-you", waits: "question", question: { requestId: "q1", threadId: "t1", title: "Which branch?", choices: ["main", "dev"] } });
    const structured = ambientBot(bot({ messages: [question({ questionRequest: { version: 1, questions: [{ question: "Ship it now?", options: [{ label: "Yes" }, { label: "Later" }] }] } })] }), [], turnLive);
    expect(structured.question).toMatchObject({ title: "Ship it now?", choices: ["Yes", "Later"] });
    const many = ambientBot(bot({ messages: [question({ options: ["a", "b", "c", "d", "e"] })] }), [], turnLive);
    expect(many).toMatchObject({ waits: "question", question: null });
    const multi = ambientBot(bot({ messages: [question({ questionRequest: { version: 1, questions: [{ question: "Pick", multiSelect: true, options: [{ label: "x" }, { label: "y" }] }] } })] }), [], turnLive);
    expect(multi.question).toBeNull();
    expect(ambientBot(bot({ messages: [question({ answered: "answer" })] }), [], turnLive)).toMatchObject({ waits: null, question: null });
    expect(ambientBot(bot({ messages: [approval()] }), [], turnLive).waits).toBe("approval");
    expect(ambientBot(bot({ activity: "waiting-on-you" }), [], turnLive).waits).toBe("other");
  });

  it("counts only a real ask as needing the person: never an intro's suggestions or a plain reply", () => {
    const intro = message({ kind: "options", helperIntro: true, card: { title: "Hey! I'm Nova. I'm new here.", options: ["Plan my week", "Sort my inbox"] } } as Partial<Message>);
    expect(ambientBot(bot({ unread: true, messages: [intro] }), [], turnLive)).toMatchObject({ status: "done", waits: null, question: null });
    expect(ambientBot(bot({ messages: [intro] }), [], turnLive).status).toBe("idle");
    const signIn = message({ kind: "signin", signIn: { site: "Gmail" } } as unknown as Partial<Message>);
    expect(ambientBot(bot({ messages: [signIn] }), [], turnLive)).toMatchObject({ status: "needs-you", waits: "sign-in", detail: "Sign in to Gmail" });
  });

  it("takes a typed answer where the question allows one, and names the step a turn is on", () => {
    const open = message({ kind: "options", card: { title: "Which city?", subtitle: "", options: [], requestId: "q9", requestType: "question" } } as Partial<Message>);
    expect(ambientBot(bot({ messages: [open] }), [], turnLive).question).toMatchObject({ requestId: "q9", choices: [], custom: true });
    const fixed = message({ kind: "options", card: { title: "Ship?", subtitle: "", options: ["Yes", "No"], fixedOptions: true, requestId: "q8", requestType: "question" } } as Partial<Message>);
    expect(ambientBot(bot({ messages: [fixed] }), [], turnLive).question).toMatchObject({ choices: ["Yes", "No"], custom: false });
    const busy = bot({ busy: true, messages: [message({ role: "user", text: "Find flights" })] });
    noteTurnEvent({ type: "content.delta", threadId: "t1", turnId: "u1", streamKind: "reasoning_text", delta: "" } as never);
    expect(ambientBot(busy, [], turnLive).step).toBe("thinking");
    expect(ambientBot(bot(), [], turnLive).step).toBeNull();
  });

  it("marks an unread reply done, a failed step an error, and the rest idle with their newest line", () => {
    const reply = message({ text: "The footer is fixed." });
    expect(ambientBot(bot({ unread: true, messages: [reply] }), [], turnLive)).toMatchObject({ status: "done", unread: true, line: "The footer is fixed.", at: reply.at });
    expect(ambientBot(bot({ messages: [message({ kind: "activity", tool: { name: "Bash", ok: false } })] }), [], turnLive).status).toBe("error");
    expect(ambientBot(bot({ messages: [reply] }), [], turnLive).status).toBe("idle");
  });

  it("leaves out hidden and moved bots, and only passes this app's own pictures", () => {
    const snapshot = ambientSnapshot([
      bot({ avatarUrl: "/api/bots/nova/avatar.png", avatarCrop: "circle" } as Partial<Bot>),
      bot({ id: "ghost", hidden: true }),
      bot({ id: "moved", movedTo: { kind: "cloud" } } as unknown as Partial<Bot>),
      bot({ id: "far", avatarUrl: "https://example.com/a.png", avatarCrop: "circle" } as Partial<Bot>),
    ], [], turnLive, "en");
    expect(snapshot.bots.map((entry) => [entry.id, entry.avatar])).toEqual([["nova", "/api/bots/nova/avatar.png"], ["far", null]]);
    expect(snapshot.labels.idle).toBe("Idle");
    expect(snapshot.lang).toBe("en");
  });
});
