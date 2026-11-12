import { expect, it } from "vitest";

import { brandCase, brandCaseEntry } from "./brand-case";
import en from "./en.json";

it("English copy is lowercase, apart from other companies' names, acronyms, code and placeholders", () => {
  const offending = Object.entries(en as Record<string, string>)
    .filter(([key, value]) => brandCaseEntry(key, value) !== value)
    .map(([key, value]) => `${key}: "${value}" should read "${brandCaseEntry(key, value)}"`);
  expect(offending, "new sentence-case strings; write them lowercase, or add a real proper noun to src/locales/brand-case.ts").toEqual([]);
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
