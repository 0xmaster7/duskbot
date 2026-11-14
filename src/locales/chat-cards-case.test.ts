import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

import { isFragment, startsRight } from "./brand-case";
import en from "./en.json";

const english = en as Record<string, string>;

/** the cards in the chat window and the computer view they open; every word they show starts with a capital */
const CHAT_CARDS = [
  "SignInRequestCard", "SignInScreen", "AskCard", "ApprovalCard", "PendingApproval", "QuestionCard", "OptionCard",
  "OptionsCardRow", "ConnectorCard", "SecretRequestCard", "SetupOffer", "HelperKeySuggestion", "PublishedPageCard",
  "FailedReplyCard", "ComputerFullscreen", "LiveDesktop", "RichTable", "AttachmentPreview",
  "widget/WidgetMessage", "widget/WidgetBody", "widget/WidgetContent", "widget/WidgetControls", "widget/WidgetChart",
  "widget/WidgetDayPicker", "widget/WidgetTimePicker", "widget/WidgetTable", "widget/WidgetChoices",
];

it("every word a chat card shows reads in sentence case", () => {
  const offending: string[] = [];
  for (const name of CHAT_CARDS) {
    const source = readFileSync(new URL(`../components/${name}.tsx`, import.meta.url), "utf8");
    for (const [, key] of source.matchAll(/["'`]([a-zA-Z]+(?:\.[\w]+)+)["'`]/g)) {
      const value = english[key!];
      if (typeof value !== "string" || isFragment(key!) || startsRight(value)) continue;
      offending.push(`${name}: ${key} = "${value}" starts lowercase`);
    }
  }
  expect([...new Set(offending)]).toEqual([]);
});

it("the computer sign-in card reads in sentence case", () => {
  expect(english["signIn.actionNeeded"]).toBe("Action needed");
  expect(english["signIn.instruction"]).toBe("Sign in to {site}");
  expect(english["signIn.skip"]).toBe("Skip");
  expect(english["computer.done"]).toBe("I'm done");
  expect(english["signIn.takeOver"]).toBe("Take over");
});
