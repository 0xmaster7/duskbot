import { describe, expect, it } from "vitest";

import { CHAT_WIDTH_IDS } from "../src/lib/chat-width";
import { FONT_IDS } from "../src/lib/fonts";
import { SEND_KEYS } from "../src/lib/send-key";
import { SKIN_IDS } from "../src/lib/skins";
import { localePacks } from "../src/locales";
import { APP_PREF_SETTINGS } from "./app-prefs";
import { SYNCED_UI_PREFS } from "./synced-prefs";

describe("app preferences a bot may set", () => {
  it("offer exactly the values the page accepts, under preferences that follow the person", () => {
    expect([...APP_PREF_SETTINGS.theme.values].sort()).toEqual(["system", ...SKIN_IDS].sort());
    expect([...APP_PREF_SETTINGS.font.values]).toEqual([...FONT_IDS]);
    expect([...APP_PREF_SETTINGS.chat_width.values]).toEqual([...CHAT_WIDTH_IDS]);
    expect([...APP_PREF_SETTINGS.send_key.values]).toEqual([...SEND_KEYS]);
    expect([...APP_PREF_SETTINGS.language.values].sort()).toEqual([...new Set(Object.values(localePacks))].sort());
    for (const { pref } of Object.values(APP_PREF_SETTINGS)) expect(SYNCED_UI_PREFS).toContain(pref);
  });
});
