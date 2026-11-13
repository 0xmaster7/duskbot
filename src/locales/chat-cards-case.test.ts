import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

import { isChatEntry, isPanelEntry } from "./brand-case";
import en from "./en.json";

const english = en as Record<string, string>;

/** the cards in the chat window and the computer view they open; every word they show reads in sentence case */
const CHAT_CARDS = [
  "SignInRequestCard", "SignInScreen", "AskCard", "ApprovalCard", "PendingApproval", "QuestionCard", "OptionCard",
  "OptionsCardRow", "ConnectorCard", "SecretRequestCard", "SetupOffer", "HelperKeySuggestion", "PublishedPageCard",
  "FailedReplyCard", "ComputerFullscreen", "LiveDesktop", "RichTable", "AttachmentPreview",
  "widget/WidgetMessage", "widget/WidgetBody", "widget/WidgetContent", "widget/WidgetControls", "widget/WidgetChart",
  "widget/WidgetDayPicker", "widget/WidgetTimePicker", "widget/WidgetTable", "widget/WidgetChoices",
];

/** spoken-only words, and places' names that are filled into the middle of another line */
const QUIET = /(^|\.)aria\w*(\.|$)|Aria/;
const FRAGMENTS = /^(computer\.badge\.(local|vps)|vm\.dest\.vm|approval\.voice\.action\w+)$/;

it("every word a chat card shows reads in sentence case, so none of its keys is a lowercase label", () => {
  const offending: string[] = [];
  for (const name of CHAT_CARDS) {
    const source = readFileSync(new URL(`../components/${name}.tsx`, import.meta.url), "utf8");
    for (const [, key] of source.matchAll(/["'`]([a-zA-Z]+(?:\.[\w]+)+)["'`]/g)) {
      const value = english[key!];
      if (typeof value !== "string" || QUIET.test(key!) || FRAGMENTS.test(key!)) continue;
      if (!/^[a-z]/.test(value) || /^dusk\b/.test(value)) continue;
      offending.push(isChatEntry(key!) || isPanelEntry(key!) ? `${name}: ${key} = "${value}" starts lowercase`
        : `${name}: ${key} = "${value}" is not under the chat window's sentence-case policy (src/locales/brand-case.ts)`);
    }
  }
  expect([...new Set(offending)], "add the key to the chat window's list in brand-case.ts, or give the card its own copy of a word shared with settings").toEqual([]);
});

it("the computer sign-in card reads in sentence case", () => {
  expect(english["signIn.actionNeeded"]).toBe("Action needed");
  expect(english["signIn.instruction"]).toBe("Sign in to {site}");
  expect(english["signIn.skip"]).toBe("Skip");
  expect(english["computer.done"]).toBe("I'm done");
  expect(english["signIn.takeOver"]).toBe("Take over");
});
