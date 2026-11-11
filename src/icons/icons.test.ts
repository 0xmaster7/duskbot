import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ICONS } from "../components/Icon";
import { WIDGET_ICONS } from "../components/widget/widget-icons";
import * as glyphs from "./index";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SHAPE = /<(path|circle|rect|ellipse)\b[^>]*>/g;

function drawn(html: string): boolean {
  const shapes = html.match(SHAPE) ?? [];
  return shapes.some((tag) => !tag.startsWith("<path") || / d="[^"]{8,}"/.test(tag));
}

/** every name imported from the icon module anywhere in the app, dashboard or phone */
function importedNames(): string[] {
  const files = execFileSync("git", ["grep", "-l", "-E", "from \"(\\.\\.?/)+icons\"|from \"@/icons\"", "--", "src", "apps"], { cwd: ROOT, encoding: "utf8" })
    .split("\n").filter(Boolean);
  const names = new Set<string>();
  for (const file of files) {
    const text = readFileSync(ROOT + file, "utf8");
    for (const [, list] of text.matchAll(/import\s*\{([^}]*)\}\s*from\s*"(?:(?:\.\.?\/)+icons|@\/icons)"/g)) {
      for (const part of list!.split(",")) {
        const name = part.trim().split(/\s+as\s+/)[0]!;
        if (name && !name.startsWith("type ")) names.add(name);
      }
    }
  }
  return [...names];
}

describe("icon set", () => {
  const exported = glyphs as unknown as Record<string, glyphs.GlyphIcon>;

  it("has a drawing for every icon the app imports", () => {
    const names = importedNames();
    expect(names.length).toBeGreaterThan(150);
    for (const name of names) {
      const Glyph = exported[name];
      expect(Glyph, name).toBeTypeOf("function");
      const html = renderToStaticMarkup(createElement(Glyph!, { size: 16 }));
      expect(html, name).toMatch(/^<svg [^>]*viewBox="[^"]+"/);
      expect(drawn(html), `${name} draws nothing`).toBe(true);
    }
  });

  it("draws every named and widget icon, outline and filled", () => {
    for (const [name, Glyph] of [...Object.entries(ICONS), ...Object.entries(WIDGET_ICONS)]) {
      for (const fill of [undefined, "currentColor"]) {
        const html = renderToStaticMarkup(createElement(Glyph, { size: 20, fill }));
        expect(drawn(html), `${name} ${fill ?? "outline"}`).toBe(true);
        expect(html, name).toContain('aria-hidden="true"');
      }
    }
  });

  it("ships no page-global ids, which collide between copies of an icon", () => {
    for (const [name, Glyph] of Object.entries(exported)) {
      if (typeof Glyph !== "function") continue;
      for (const fill of [undefined, "currentColor"]) expect(renderToStaticMarkup(createElement(Glyph, { fill })), name).not.toMatch(/ id="/);
    }
  });
});
