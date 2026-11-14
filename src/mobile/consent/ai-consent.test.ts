import { describe, expect, it } from "vitest";
import { aiProviders, consentCovers, consentKey, createConsentStore, parseConsent } from "./ai-consent";

const prefs = () => {
  const values = new Map<string, string>();
  return { values, prefs: { get: async (key: string) => values.get(key) ?? null, set: async (key: string, value: string) => { values.set(key, value); }, remove: async (key: string) => { values.delete(key); } } };
};
const bot = (instanceId: string) => ({ modelSelection: { instanceId, model: "m" } });
const instances = [{ instanceId: "claude", displayName: "Claude Code" }, { instanceId: "codex", displayName: "Codex" }];

describe("ai consent", () => {
  it("names each AI the bots use once, by the computer's name for it", () => {
    expect(aiProviders([bot("codex"), bot("claude"), bot("codex"), bot("gone")], instances)).toEqual(["Claude Code", "Codex"]);
    expect(aiProviders([], instances)).toEqual([]);
  });

  it("is per account and per linked computer", () => {
    expect(consentKey("acct", "conn")).not.toBe(consentKey(null, "conn"));
    expect(consentKey("acct", "conn")).not.toBe(consentKey("acct", "other"));
  });

  it("covers only the AIs the person saw named; a new one asks again", () => {
    const allowed = { answer: "allowed" as const, at: 1, providers: ["Codex"] };
    expect(consentCovers(allowed, ["Codex"])).toBe(true);
    expect(consentCovers(allowed, ["Codex", "Claude Code"])).toBe(false);
    expect(consentCovers({ answer: "declined", at: 1 }, [])).toBe(false);
    expect(consentCovers(null, [])).toBe(false);
  });

  it("reads back only a well-formed answer", () => {
    expect(parseConsent(JSON.stringify({ answer: "allowed", at: 2, providers: ["Codex"] }))).toEqual({ answer: "allowed", at: 2, providers: ["Codex"] });
    expect(parseConsent(JSON.stringify({ answer: "declined", at: 2 }))).toEqual({ answer: "declined", at: 2 });
    for (const bad of [null, "", "{", JSON.stringify({ answer: "allowed", at: 2 }), JSON.stringify({ answer: "yes", at: 2 }), JSON.stringify({ answer: "declined" })]) expect(parseConsent(bad)).toBeNull();
  });

  it("saves an answer, can be turned off again, and tells whoever listens", async () => {
    const { values, prefs: store } = prefs();
    const consent = createConsentStore(store, "k", () => 5);
    await consent.ready;
    expect(consent.loaded()).toBe(true);
    expect(consent.get()).toBeNull();
    let heard = 0;
    consent.subscribe(() => { heard++; });
    await consent.allow(["Codex"]);
    expect(JSON.parse(values.get("k")!)).toEqual({ answer: "allowed", at: 5, providers: ["Codex"] });
    await consent.decline();
    expect(consent.get()).toEqual({ answer: "declined", at: 5 });
    expect(heard).toBe(2);
    const again = createConsentStore(store, "k");
    await again.ready;
    expect(again.get()).toEqual({ answer: "declined", at: 5 });
  });
});
