import { describe, expect, it } from "vitest";

import { grokCategories } from "./catalog";
import { loadComposioSnapshot, loadToolkitActions, mergeCatalog, snapshotToolkit, type ComposioSnapshot } from "./composio-snapshot";

const bundled: ComposioSnapshot = {
  source: "test", count: 3,
  toolkits: [
    { slug: "gmail", name: "Gmail", description: "Email from Google, with search and labels", category: "email", tools: 63 },
    { slug: "attio", name: "Attio", description: "A CRM", category: "crm", tools: 40 },
    { slug: "clockify", name: "Clockify", description: "Time tracking", category: "time tracking software", logo: "https://clockify.me/logo.svg", tools: 9 },
  ],
};
const live = (slug: string, extra: object = {}) => ({ slug, label: slug, blurb: `${slug} live`, logo: null, domain: null, ...extra });

describe("the bundled Composio catalog", () => {
  it("leads when there is no live catalog, keeping curated apps it lacks", () => {
    const cards = mergeCatalog([live("gmail"), live("homegrown")], "curated", bundled)!;
    expect(cards.map((card) => card.slug)).toEqual(["gmail", "attio", "clockify", "homegrown"]);
    expect(cards[0]).toMatchObject({ label: "Gmail", logo: "https://logos.composio.dev/api/gmail", categories: ["email"] });
    expect(cards[2]!.logo).toBe("https://clockify.me/logo.svg");
    expect(mergeCatalog(null, undefined, bundled)!.length).toBe(3);
  });

  it("follows the live catalog when there is one, fills in what it leaves out, then adds the rest", () => {
    const cards = mergeCatalog([live("attio", { categories: ["Sales"] }), live("gmail")], "api", bundled)!;
    expect(cards.map((card) => card.slug)).toEqual(["attio", "gmail", "clockify"]);
    expect(cards[0]).toMatchObject({ categories: ["Sales"], blurb: "A CRM", logo: "https://logos.composio.dev/api/attio" });
    expect(cards[1]).toMatchObject({ categories: ["email"], blurb: "Email from Google, with search and labels" });
    expect(mergeCatalog([live("gmail")], "api", null)).toEqual([live("gmail")]);
  });

  it("ships over a thousand toolkits, each with a name, what it does and a category, and their actions load by slug", async () => {
    const snapshot = (await loadComposioSnapshot())!;
    expect(snapshot.count).toBe(snapshot.toolkits.length);
    expect(snapshot.toolkits.length).toBeGreaterThan(1000);
    const slugs = new Set<string>();
    for (const toolkit of snapshot.toolkits) {
      expect(toolkit.slug).toMatch(/^[a-z0-9_][a-z0-9_-]{0,80}$/);
      expect(slugs.has(toolkit.slug)).toBe(false);
      slugs.add(toolkit.slug);
      expect(toolkit.name && toolkit.description && toolkit.category).toBeTruthy();
      expect(`${toolkit.name} ${toolkit.description}`).not.toContain("\u2014");
    }
    const filed = snapshot.toolkits.filter((toolkit) => grokCategories([toolkit.category])[0] !== "other").length;
    expect(filed / snapshot.toolkits.length, "nearly every app lands in a named category").toBeGreaterThan(0.95);
    expect(snapshotToolkit("gmail")).toMatchObject({ name: "Gmail", managed: true });
    expect((await loadToolkitActions("gmail"))?.actions.length).toBeGreaterThan(0);
    expect(await loadToolkitActions("no-such-toolkit")).toBeNull();
  });

  it("finds every app's actions in the file the script wrote them to", async () => {
    const snapshot = (await loadComposioSnapshot())!;
    const listed = snapshot.toolkits.filter((toolkit) => toolkit.tools > 0);
    const found = await Promise.all(listed.map((toolkit) => loadToolkitActions(toolkit.slug)));
    expect(found.filter((actions) => !actions?.actions.length).length).toBe(0);
  });
});
