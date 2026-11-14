import { describe, expect, it } from "vitest";

import { introFallback, introName, introPrompt } from "./bot-intro.ts";

describe("a new bot's intro words", () => {
  it("capitalises a name typed in lower case and keeps one already cased", () => {
    expect(introName("writer")).toBe("Writer");
    expect(introName("McBot")).toBe("McBot");
    expect(introFallback(undefined, { name: "writer" })).toBe("Hi, I'm Writer. Tell me what you'd like to start with and I'll take it from there.");
  });

  it("grounds the hello in the template, apps, place and team it is given", () => {
    const prompt = introPrompt({
      name: "Edie",
      template: { category: "writing", title: "Writer and editor", tryAsking: ["Tighten this email"], apps: ["gmail"], routines: [] },
      apps: [],
      place: "this Mac",
      person: "Sam",
      teammates: [{ name: "Ledger", title: "Bookkeeper" }],
    });
    expect(prompt).toContain("Your name, as you write it: Edie.");
    expect(prompt).toContain("You run on this Mac.");
    expect(prompt).toContain("\"Writer and editor\" ready-made bot (writing)");
    expect(prompt).toContain("Tighten this email");
    expect(prompt).toContain("No connected apps are available to you yet; you work best with gmail");
    expect(prompt).toContain("Their other bots: Ledger (Bookkeeper).");
    expect(prompt).toContain("never an em dash");
  });

  it("says nothing about apps when the app could not tell, and names a from-scratch bot as such", () => {
    const prompt = introPrompt({ name: "Nova", apps: null, place: "dusk cloud", teammates: [], language: "de" });
    expect(prompt).not.toContain("connected apps you can use");
    expect(prompt).toContain("made from scratch");
    expect(prompt).toContain("Write it in German.");
  });
});
