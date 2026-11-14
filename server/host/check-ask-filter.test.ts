import { describe, expect, it } from "vitest";
import type { Message } from "../store.ts";
import { pendingCheckCard, restatesCheckAsk, withoutCheckAsk } from "./check-ask-filter.ts";

describe("a bot's lines beside a human-check card", () => {
  it.each([
    "Pastebin is showing a Cloudflare check. Please complete this check on the cloud computer.",
    "Could you complete the human check on the cloud computer? I'll carry on from there.",
    "Pastebin wants a quick human check. Tap Take over and I'll carry on from there.",
    "I hit a security verification page on pastebin.com.",
    "Waiting for you to finish the captcha.",
  ])("drops a line that only says the ask again: %s", (text) => {
    expect(withoutCheckAsk(text)).toBe("");
  });

  it("keeps what is new: other routes, findings, results", () => {
    expect(withoutCheckAsk("Pastebin is showing a Cloudflare check. I drafted the paste with your notes, 214 lines.")).toBe("I drafted the paste with your notes, 214 lines.");
    expect(withoutCheckAsk("Cloudflare blocked pastebin, so I used dpaste instead: https://dpaste.org/abc")).toBe("Cloudflare blocked pastebin, so I used dpaste instead: https://dpaste.org/abc");
    expect(withoutCheckAsk("Here's the summary:\n\n- 3 open issues\n- 1 PR")).toBe("Here's the summary:\n\n- 3 open issues\n- 1 PR");
    expect(restatesCheckAsk("The verification step in your signup form is broken.")).toBe(false);
  });

  it("knows the card still waiting in the current task, and none after the person spoke or the card settled", () => {
    const card = { id: "c", role: "bot", kind: "signin", signIn: { url: "https://pastebin.com/", site: "pastebin.com", place: "cloud", check: true } } as Message;
    const said = { id: "u", role: "user", kind: "text", text: "post it" } as Message;
    expect(pendingCheckCard([said, card])?.id).toBe("c");
    expect(pendingCheckCard([card, said])).toBeNull();
    expect(pendingCheckCard([said, { ...card, signIn: { ...card.signIn!, done: true } }])).toBeNull();
    expect(pendingCheckCard([said, { ...card, signIn: { ...card.signIn!, check: undefined } }])).toBeNull();
    expect(pendingCheckCard([said, { ...card, from: { botId: "other", name: "O", color: "red" } }], "me")).toBeNull();
  });
});
