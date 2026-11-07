import { createElement, type KeyboardEvent } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { askPrimary, AskCard, AskChoices, AskDetail, AskHeader, AskReply, AskSettledLine, ASK_SECONDARY_BUTTON, ASK_QUIET_ANSWER, CARD_BUTTON_MD, CARD_FIELD, CardSettledRow, cardPrimary, cardSecondary, cardTertiary, moveChoiceFocus, settledAnswer } from "./AskCard";

afterEach(() => vi.unstubAllGlobals());

const classesOf = (html: string, at: RegExp) => (at.exec(html)?.[1] ?? "").split(" ");
const LONG = "Yes, the welcome text too, and the footer text of the pricing page, on branch fix/pricing-page-footer";

describe("AskCard", () => {
  it("is one raised card in both modes: the composer's surface, grok's 0.5px 12% hairline, rounded 24, 560 wide", () => {
    const html = renderToStaticMarkup(createElement(AskCard, { ariaLabel: "Plan", title: "Choose a plan", explanation: "Why it asks." }));
    const card = classesOf(html, /^<div[^>]*class="([^"]*)"/);
    expect(card).toEqual(expect.arrayContaining(["bg-composer", "ring-[0.5px]", "ring-(--card-ring)", "rounded-[24px]", "max-w-[560px]", "w-full", "text-start"]));
    expect(html).toContain('role="group"');
    expect(html).toContain('aria-label="Plan"');
    expect(html).toContain("Why it asks.");
    expect(card).toContain("shadow-[0_2px_8px_var(--card-lift)]");
  });

  it("puts the question in clear ink at reading size, under a header line in secondary ink that names the bot that asks", () => {
    const header = createElement(AskHeader, { asker: { name: "Ledger", color: "teal" }, line: "Ledger asks" });
    const html = renderToStaticMarkup(createElement(AskCard, { ariaLabel: "Q", header, title: "Should I apply the fix?" }));
    expect(html).toMatch(/text-\[15px\] font-semibold leading-\[22px\] text-ink"><bdi dir="auto">Should I apply the fix\?</);
    expect(html).toMatch(/data-ask-header="" class="[^"]*text-\[13px\][^"]*text-ink-secondary[^"]*"/);
    expect(html.indexOf("Ledger asks")).toBeLessThan(html.indexOf("Should I apply the fix?"));
  });

  it("offers a dismiss button only with a name for it", () => {
    const base = { ariaLabel: "Key", title: "API key" };
    expect(renderToStaticMarkup(createElement(AskCard, { ...base, onDismiss: () => {} }))).not.toContain("<button");
    expect(renderToStaticMarkup(createElement(AskCard, { ...base, onDismiss: () => {}, dismissLabel: "Not now" }))).toContain('aria-label="Not now"');
  });
});

describe("AskChoices", () => {
  const render = (props: Partial<Parameters<typeof AskChoices>[0]> = {}) => renderToStaticMarkup(createElement(AskChoices, {
    choices: [{ label: "Yes, only the footer text" }, { label: LONG }, { label: "No" }], label: "Should I?", onPick: () => {}, ...props,
  }));

  it("is one button per choice, stacked, at least 36px tall and 44 on touch, with a label that wraps instead of being cut", () => {
    const html = render();
    const buttons = html.match(/<button[^>]*data-ask-choice[^>]*>/g)!;
    expect(buttons).toHaveLength(3);
    for (const tag of buttons) {
      const classes = classesOf(tag, /class="([^"]*)"/);
      expect(classes).toEqual(expect.arrayContaining(["min-h-10", "pointer-coarse:min-h-11", "w-full", "text-start", "focus-visible:ring-2"]));
      expect(classes).not.toContain("truncate");
      expect(classes).not.toContain("whitespace-nowrap");
    }
    expect(html).toContain('role="radiogroup"');
    expect(html).toMatch(/class="block break-words[^"]*">Yes, the welcome text too/);
  });

  it("has no letter keys: a choice is pressed, never typed", () => {
    const html = render();
    expect(html).not.toContain("aria-keyshortcuts");
    expect(html).not.toMatch(/>A</);
  });

  it("shows the tapped choice on its way and holds the others until it lands", () => {
    const html = render({ sending: "No" });
    const tags = html.match(/<button[^>]*data-ask-choice[^>]*>/g)!;
    expect(tags[2]).toContain('aria-busy="true"');
    expect(tags[2]).toContain('aria-checked="true"');
    expect(tags[2]).not.toContain(' disabled=""');
    expect(tags[0]).toContain(' disabled=""');
    expect(html).toContain("motion-safe:animate-spin");
  });

  it("is a checkbox group for several picks, and tags each choice for the surface that shows it", () => {
    const html = render({ multi: true, picked: ["No"], tag: "data-inbox-choice" });
    expect(html).toContain('role="group"');
    expect(html).toContain('role="checkbox"');
    expect(html).toContain('data-inbox-choice="No"');
  });
});

describe("the card's buttons", () => {
  it("are 36px tall, 44 on touch: the answer in grok's ink whoever asks, the rest quiet and neutral", () => {
    const primary = askPrimary("teal");
    expect(primary.className.split(" ")).toEqual(expect.arrayContaining(["ui-button-primary", "min-h-9", "pointer-coarse:min-h-11"]));
    expect(primary.className).not.toContain("bot-button");
    expect(primary.style).toBeUndefined();
    expect(askPrimary(undefined).className.split(" ")).toEqual(expect.arrayContaining(["ui-button-primary", "min-h-9"]));
    expect(ASK_SECONDARY_BUTTON.split(" ")).toEqual(expect.arrayContaining(["min-h-9", "pointer-coarse:min-h-11", "bg-ink/[0.07]", "text-ink"]));
    expect(ASK_SECONDARY_BUTTON).not.toContain("danger");
    expect(ASK_QUIET_ANSWER.split(" ")).toEqual(expect.arrayContaining(["min-h-9", "text-ink-secondary"]));
  });
});

describe("grok's card anatomy", () => {
  it("puts a source titlebar over the title, a 20px tile and a medium 13px name, and keeps the dismiss in it", () => {
    const html = renderToStaticMarkup(createElement(AskCard, { ariaLabel: "Key", title: "API key", explanation: "Why.", source: { icon: "K", label: "Secrets" }, onDismiss: () => {}, dismissLabel: "Not now" }));
    expect(html).toMatch(/min-h-\[52px\][^"]*px-4 py-3\.5/);
    expect(html).toMatch(/size-5[^"]*rounded-\[6px\][^"]*border-\(--card-fill\)[^"]*bg-\(--card-fill\)/);
    expect(html).toMatch(/text-\[13px\] font-medium leading-\[18px\] text-ink">Secrets</);
    expect(html.indexOf("Secrets")).toBeLessThan(html.indexOf("API key"));
    expect(html.indexOf('aria-label="Not now"')).toBeLessThan(html.indexOf("API key"));
    expect(html).toMatch(/class="px-5 py-1"><p class="[^"]*text-\[15px\] font-semibold leading-\[22px\]/);
  });

  it("folds a settled card to one 52px row in the same frame, rounded 18, which opens to its detail", () => {
    const html = renderToStaticMarkup(createElement(CardSettledRow, { icon: "K", label: "Secrets", summary: "Saved · Stripe key", title: "Stripe key", detail: "Saved securely." }));
    expect(html).toContain('data-ask-card="settled"');
    expect(html).toContain("rounded-[18px]");
    expect(html).toContain("ring-(--card-ring)");
    expect(html).toContain('aria-expanded="false"');
    expect(html).toMatch(/text-ink-tertiary">Saved · Stripe key</);
    expect(html).not.toContain("Saved securely.");
  });

  it("keeps a card field's hairline when focused, with only the keyboard's grey ring", () => {
    const classes = CARD_FIELD.split(" ");
    expect(classes).toEqual(expect.arrayContaining(["border", "bg-transparent", "rounded-[10px]", "h-8", "focus-visible:ring-2"]));
    expect(classes.some((name) => name.startsWith("focus:"))).toBe(false);
    expect(CARD_FIELD).not.toMatch(/ring-(accent|focus|blue)/);
  });

  it("sizes the answers like grok: 36 for a card's own, 32 for a permission's, ink, a 6% fill, bare text", () => {
    expect(cardPrimary().className.split(" ")).toEqual(expect.arrayContaining(["h-9", "px-4", "ui-button-primary", "pointer-coarse:h-11"]));
    expect(cardPrimary(CARD_BUTTON_MD).className.split(" ")).toEqual(expect.arrayContaining(["h-8", "px-3.5"]));
    expect(cardSecondary().split(" ")).toEqual(expect.arrayContaining(["bg-(--card-fill)", "font-medium", "text-ink"]));
    expect(cardTertiary().split(" ")).toEqual(expect.arrayContaining(["font-normal", "text-ink-secondary"]));
    expect(cardTertiary()).not.toMatch(/(^| )bg-/);
  });
});

describe("AskReply", () => {
  it("is a field with an ink send button, which waits for words", () => {
    const html = renderToStaticMarkup(createElement(AskReply, { label: "Answer", placeholder: "Write your answer", color: "teal", value: "", onChange: () => {}, onSend: () => {} }));
    expect(html).toContain('placeholder="Write your answer"');
    expect(html).toMatch(/<button type="submit" disabled=""[^>]*class="[^"]*ui-button-primary/);
  });
});

describe("AskDetail", () => {
  it("folds a long command after three lines, and keeps a short one whole", () => {
    expect(renderToStaticMarkup(createElement(AskDetail, { text: "git push", mono: true }))).not.toContain("line-clamp-3");
    const long = renderToStaticMarkup(createElement(AskDetail, { text: "git push origin fix/pricing-page-footer ".repeat(6), mono: true }));
    expect(long).toContain("line-clamp-3");
    expect(long).toContain("font-mono");
    expect(long).toContain('aria-expanded="false"');
  });
});

describe("AskSettledLine", () => {
  it("settles into one calm line that announces itself, with its own mark for an answer, a stop and an expiry", () => {
    const html = renderToStaticMarkup(createElement(AskSettledLine, { ariaLabel: "Plan", children: settledAnswer("Yes, only the footer text", ["Yes, only the footer text", "No"]) }));
    expect(html).toContain('data-ask-card="settled"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("You chose:");
    expect(html).toContain("Yes, only the footer text");
    expect(html).toContain("text-success");
    expect(renderToStaticMarkup(createElement(AskSettledLine, { children: settledAnswer("Not until tomorrow", ["Yes", "No"]) }))).toContain("You answered:");
    expect(renderToStaticMarkup(createElement(AskSettledLine, { tone: "stopped", children: "Stopped" }))).toContain('data-tone="stopped"');
    expect(renderToStaticMarkup(createElement(AskSettledLine, { tone: "expired", children: "Expired" }))).toContain('data-tone="expired"');
  });
});

describe("moveChoiceFocus", () => {
  function setup(direction: "ltr" | "rtl", focused: number) {
    const items = [0, 1, 2].map(() => ({ focus: vi.fn() }));
    vi.stubGlobal("document", { activeElement: items[focused] });
    vi.stubGlobal("getComputedStyle", () => ({ direction }));
    const group = { querySelectorAll: () => items };
    const press = (key: string) => {
      const event = { key, currentTarget: group, preventDefault: vi.fn() } as unknown as KeyboardEvent<HTMLElement>;
      moveChoiceFocus(event);
      return event;
    };
    return { items, press };
  }

  it("moves forward and wraps with the arrows", () => {
    const { items, press } = setup("ltr", 2);
    press("ArrowRight");
    expect(items[0]!.focus).toHaveBeenCalled();
  });

  it("follows the reading direction in a right-to-left chat", () => {
    const { items, press } = setup("rtl", 0);
    press("ArrowLeft");
    expect(items[1]!.focus).toHaveBeenCalled();
  });

  it("jumps to the ends with Home and End", () => {
    const { items, press } = setup("ltr", 1);
    press("End");
    expect(items[2]!.focus).toHaveBeenCalled();
    press("Home");
    expect(items[0]!.focus).toHaveBeenCalled();
  });

  it("leaves every other key alone", () => {
    const { items, press } = setup("ltr", 1);
    const event = press("Enter");
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(items.every((item) => item.focus.mock.calls.length === 0)).toBe(true);
  });
});
