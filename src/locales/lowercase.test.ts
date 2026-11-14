import { expect, it } from "vitest";

import { brandCase, entryCase, isChatEntry, isPanelEntry, isSentenceEntry, sentenceCase } from "./brand-case";
import en from "./en.json";

const entries = Object.entries(en as Record<string, string>);
const english = en as Record<string, string>;

it("UI labels are lowercase, apart from other companies' names, acronyms, code and placeholders", () => {
  const offending = entries
    .filter(([key, value]) => !isSentenceEntry(key, value) && entryCase(key, value) !== value)
    .map(([key, value]) => `${key}: "${value}" should read "${entryCase(key, value)}"`);
  expect(offending, "labels stay lowercase; add a real proper noun to src/locales/brand-case.ts, or a key rule if this is a full-sentence message").toEqual([]);
});

it("full-sentence messages read as sentences: each sentence starts with a capital, the product name stays lowercase", () => {
  const offending = entries
    .filter(([key, value]) => isSentenceEntry(key, value) && entryCase(key, value) !== value)
    .map(([key, value]) => `${key}: "${value}" should read "${entryCase(key, value)}"`);
  expect(offending, "notices, banners, status lines, errors, toasts, empty states, dialog bodies and sentence hints start with a capital").toEqual([]);
});

it("the chat window reads in sentence case throughout, buttons and placeholders included; sidebar and settings labels stay lowercase", () => {
  expect(isChatEntry("chat.retry")).toBe(true);
  expect(isChatEntry("composer.placeholder.default")).toBe(true);
  expect(isChatEntry("approval.action.allow")).toBe(true);
  expect(isChatEntry("nativeUsage.banner.cta")).toBe(true);
  expect(isChatEntry("server.status.searchingWeb")).toBe(true);
  expect(isChatEntry("chat.copyMessage.aria")).toBe(false);
  expect(isChatEntry("sidebar.nav.settings")).toBe(false);
  expect(isChatEntry("settings.title")).toBe(false);
  expect(isChatEntry("botPanel.backups.hint")).toBe(false);
  expect(entryCase("chat.retry", "retry")).toBe("Retry");
  expect(entryCase("composer.placeholder.default", "message {name}")).toBe("Message {name}");
  expect(entryCase("settings.sync.button", "retry")).toBe("retry");
  const chat = entries.filter(([key, value]) => isChatEntry(key) && /^[a-z]/.test(value) && !/^dusk\b/.test(value));
  expect(chat.map(([key, value]) => `${key}: "${value}"`), "chat-window strings start with a capital").toEqual([]);
});

it("the bot side panel reads in sentence case, labels and rows included; the place hub's words and the left sidebar stay lowercase", () => {
  expect(isPanelEntry("botPanel.section.thisBot")).toBe(true);
  expect(isPanelEntry("botSettings.sections.access"), "shared with settings: the panel has its own copy").toBe(false);
  expect(isPanelEntry("runsOn.moveCloud")).toBe(true);
  expect(isPanelEntry("room.panel.instructions")).toBe(true);
  expect(isPanelEntry("runsOn.status.asleep")).toBe(false);
  expect(isPanelEntry("computer.simple.dest.thisMac"), "a place's name inside chat lines stays lowercase").toBe(false);
  expect(isPanelEntry("sidebar.nav.settings")).toBe(false);
  expect(isPanelEntry("sidebar.connectApps")).toBe(true);
  expect(english["botPanel.section.thisBot"]).toBe("This bot");
  expect(english["botPanel.ui.botSettingsSectionsAccess"]).toBe("Access");
  expect(english["botSettings.sections.access"]).toBe("access");
  expect(english["settings.bots.panel.botPanelSectionThisBot"]).toBe("this bot");
  expect(english["runsOn.moveCloud"]).toBe("Move to cloud desktop");
  expect(english["runsOn.getCloud"]).toBe("Get dusk cloud");
  expect(english["sidebar.connectApps"]).toBe("Connect apps");
  expect(english["runsOn.status.asleep"]).toBe("asleep");
  expect(entryCase("botPanel.x", "dusk cloud keeps it")).toBe("dusk cloud keeps it");
});

it("known messages and labels land on the right side of the split", () => {
  expect(english["nativeUsage.banner.near"]).toBe("You're at {percent}% of your {engine} usage limit.");
  expect(english["planUsage.resetsIn"]).toBe("Resets in {when}");
  expect(isSentenceEntry("settings.title", "your bots, always on.")).toBe(false);
  expect(isSentenceEntry("composer.dictation.failed", "Dictation couldn't start")).toBe(true);
  expect(isSentenceEntry("sidebar.nav.settings", "settings")).toBe(false);
  expect(isSentenceEntry("settings.keys.hint", "Paste a key")).toBe(false);
  expect(isSentenceEntry("settings.keys.hint", "paste a key here.")).toBe(true);
});

it("a chat button named inside a sentence keeps its capital, the rest of the sentence is cased as usual", () => {
  expect(entryCase("signIn.humanCheck", "{site} wants a quick human check. Tap Take over and I'll carry on from there.")).toBe("{site} wants a quick human check. Tap Take over and I'll carry on from there.");
  expect(entryCase("chat.x", "Press I'm done when you Finish.")).toBe("Press I'm done when you finish.");
  expect(entryCase("chat.x", "tap take over and wait.")).toBe("Tap take over and wait.");
  expect(english["signIn.humanCheck"]).toBe("{site} wants a quick human check. Tap Take over and I'll carry on from there.");
  expect(english["server.notify.humanCheckBody"]).toBe("Open dusk bot, tap Take over and tick the box.");
  expect(entryCase("sidebar.nav.x", "Take over"), "a label is not a sentence: it stays lowercase").toBe("take over");
});

it("sentenceCase capitalises each sentence and keeps dusk, placeholders, code and abbreviations", () => {
  expect(sentenceCase("signed out. try again, e.g. later. i'll wait")).toBe("Signed out. Try again, e.g. later. I'll wait");
  expect(sentenceCase("dusk bot is ready. dusk cloud keeps it")).toBe("dusk bot is ready. dusk cloud keeps it");
  expect(sentenceCase("{bot} is busy. open `settings.json` or notes.md")).toBe("{bot} is busy. Open `settings.json` or notes.md");
  expect(sentenceCase("your bots run 24/7. close your laptop")).toBe("Your bots run 24/7. Close your laptop");
  expect(entryCase("x.title", "Could not save. Try again.")).toBe("could not save. try again.");
});

it("brandCase keeps names, acronyms, placeholders, code and key combos", () => {
  expect(brandCase("Open Settings in Dusk Cloud")).toBe("open settings in dusk cloud");
  expect(brandCase("Sign in with Google on your Mac")).toBe("sign in with Google on your Mac");
  expect(brandCase("Turn on {app} in System Settings → Privacy & Security")).toBe("turn on {app} in System Settings → Privacy & Security");
  expect(brandCase("Paste your OpenAI API key into `CLAUDE.md`")).toBe("paste your OpenAI API key into `CLAUDE.md`");
  expect(brandCase("Press Shift+Enter. I'll wait")).toBe("press Shift+Enter. i'll wait");
  expect(brandCase("Search X with Claude Code on macOS")).toBe("search X with Claude Code on macOS");
  expect(brandCase("Open https://dusk.bot/Docs or mail Hello@dusk.bot")).toBe("open https://dusk.bot/Docs or mail Hello@dusk.bot");
});
