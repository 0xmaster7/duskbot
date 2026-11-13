import { describe, expect, it } from "vitest";
import { signInResumePrompt } from "../../shared/sign-in-request.ts";
import { createSignInRequests, type SignInRequestDeps } from "./sign-in-requests.ts";
import type { BotRecord, Message } from "../store.ts";

const bot = { id: "b1", name: "Pepper", color: "green" } as BotRecord;

function harness() {
  const messages: Message[] = [];
  const pleas: Array<{ key: string; reason: unknown; ref: Record<string, unknown> }> = [];
  const watched: unknown[] = [];
  const deps: SignInRequestDeps = {
    store: {
      appendMessage: ((_threadId: string, row: Partial<Message>) => {
        const message = { id: `m${messages.length + 1}`, at: Date.now(), ...row } as Message;
        messages.push(message);
        return message;
      }) as SignInRequestDeps["store"]["appendMessage"],
      activePath: () => messages,
      patchMessage: () => null,
    },
    connectorThread: () => ({ bot, group: undefined }),
    signInPlace: () => "browser",
    threadLanguage: () => undefined,
    followCard: () => undefined,
    computerControl: {
      requestHelp: (key, reason, ref) => { pleas.push({ key, reason, ref: { ...ref } }); return { held: false, helpReason: null, heldSinceMs: null }; },
      settleHelp: () => [],
    },
    signInControlKey: () => "b1",
    watchCheck: (ref) => { watched.push(ref); },
  };
  return { ...createSignInRequests(deps), messages, pleas, watched };
}

describe("a human check card", () => {
  it("says what to do in one line, drops the bot's reason, marks the plea a check and starts watching the page", () => {
    const run = harness();
    const made = run.requestSignIn(bot, "t1", "https://pastebin.com/", "Pastebin is asking me to verify I'm human, please take over", true);
    expect(made).toMatchObject({ site: "pastebin.com", place: "browser" });
    const card = run.messages[0]!;
    expect(card.signIn).toEqual({ url: "https://pastebin.com/", site: "pastebin.com", place: "browser", check: true });
    expect(card.text).toBe("Pepper hit a quick human check on pastebin.com. Open this conversation in dusk bot, tap Take over and tick the box.");
    expect(run.pleas).toEqual([{ key: "b1", reason: "human check on pastebin.com", ref: { botId: "b1", threadId: "t1", messageId: "m1", site: "pastebin.com", place: "browser", check: true } }]);
    expect(run.watched).toEqual([{ botId: "b1", threadId: "t1", messageId: "m1", site: "pastebin.com", place: "browser" }]);
  });

  it("leaves an ordinary sign-in card as it was, unwatched", () => {
    const run = harness();
    run.requestSignIn(bot, "t1", "example.com", "to open your orders");
    expect(run.messages[0]!.signIn).toEqual({ url: "https://example.com/", site: "example.com", place: "browser", reason: "to open your orders" });
    expect(run.pleas[0]!.reason).toBe("sign in to example.com");
    expect(run.watched).toEqual([]);
  });

  it("resumes the bot without a sign-in to check, and points a skipped check at another route", () => {
    expect(signInResumePrompt("pastebin.com", "done", true)).toMatch(/human check on pastebin\.com is cleared\. Look at the page again and carry on/);
    expect(signInResumePrompt("pastebin.com", "done", true)).not.toMatch(/signed in/);
    expect(signInResumePrompt("pastebin.com", "cancelled", true)).toMatch(/another site that does the same job or the site's API/);
    expect(signInResumePrompt("pastebin.com", "done")).toMatch(/finished signing in/);
  });
});
