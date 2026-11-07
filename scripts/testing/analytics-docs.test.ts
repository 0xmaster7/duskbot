// docs/analytics.md is the promise of what the app sends: nothing, so its track() records nothing and the page lists no
// events. The docs site shows the same page.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ROOT = new URL("../../", import.meta.url);

/** The event names in the first column of the "## Events" table; one row may name several. */
function eventRows(docs: string): string[] {
  const start = docs.indexOf("\n## Events\n");
  const end = docs.indexOf("\n## ", start + 1);
  return docs.slice(start, end === -1 ? undefined : end).split("\n")
    .filter((line) => line.startsWith("| `"))
    .flatMap((line) => [...line.split("|")[1]!.matchAll(/`([^`]+)`/g)].map((match) => match[1]!));
}

const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8").replace(/\r\n/g, "\n");

describe("docs/analytics.md", () => {
  it("promises no product events, and the app's track() sends none", () => {
    expect(read("src/lib/analytics.ts")).toMatch(/export function track\([^)]*\): void \{\}/);
    expect(eventRows(read("docs/analytics.md"))).toEqual([]);
    expect(read("docs/analytics.md")).not.toMatch(/posthog/i);
  });

  it("is the page the docs site shows", () => {
    const docs = read("docs/analytics.md");
    const site = read("apps/docs/content/docs/security/analytics.mdx");
    expect(site.slice(site.indexOf("\n---\n", 3) + "\n---\n".length)).toBe(docs.slice(docs.indexOf("\n") + 1));
  });
});
