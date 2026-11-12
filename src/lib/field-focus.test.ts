// styles.css strips the outline from text fields (Chromium matches :focus-visible on click) and draws them borderless, so a field shows focus as a deeper fill (WCAG 2.4.7).
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const src = join(dirname(fileURLToPath(import.meta.url)), "..");
const css = readFileSync(join(src, "styles.css"), "utf8");

/** Cut every `@layer` block: unlayered CSS outranks Tailwind's utilities. */
function unlayered(source: string): string {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const start = source.indexOf("@layer", i);
    if (start === -1) return out + source.slice(i);
    out += source.slice(i, start);
    const open = source.indexOf("{", start);
    const semi = source.indexOf(";", start);
    if (semi !== -1 && semi < open) {
      i = semi + 1;
      continue;
    }
    let depth = 0;
    let j = open;
    for (; j < source.length; j++) {
      if (source[j] === "{") depth++;
      else if (source[j] === "}" && --depth === 0) break;
    }
    i = j + 1;
  }
  return out;
}

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

describe("text field focus", () => {
  it("still keeps the browser outline off text fields", () => {
    expect(css).toMatch(/:is\(input(?::not\([^)]*\))?, textarea, select\):focus-visible\s*\{\s*outline:\s*none;/);
  });

  it("draws a bordered field as a quiet tinted fill with no line, above every utility", () => {
    const rules = [...unlayered(css).matchAll(/([^{}]+)\{([^}]*)\}/g)].filter(([, selector]) => selector.includes('[class~="border"]'));
    expect(rules.length).toBeGreaterThan(0);
    const [, selector, declarations] = rules[0]!;
    expect(declarations).toMatch(/border-color:\s*transparent/);
    expect(declarations).toMatch(/background-color:\s*color-mix\(in srgb, var\(--color-ink\) 5%, transparent\)/);
    expect(selector).toMatch(/:has\(> :is\(input/);
  });

  it("keeps the same look on hover, focus and active, never a ring", () => {
    const body = unlayered(css);
    const rule = [...body.matchAll(/([^{}]+)\{([^}]*)\}/g)].find(([selector]) => selector.includes('[class~="border"]'))!;
    expect(rule[1]).toMatch(/:is\(:hover, :focus, :active\)/);
    expect(rule[1]).toMatch(/:is\(:hover, :focus-within, :active\)/);
    expect(body).toMatch(/textarea, select\):focus\s*\{\s*--tw-ring-shadow: 0 0 #0000;/);
    expect(body).not.toMatch(/:focus-visible:not\(\[aria-invalid="true"\]\)\s*\{\s*border-color/);
  });

  it("never fades focus to the resting hairline", () => {
    const faint: string[] = [];
    for (const file of sources(src)) {
      readFileSync(file, "utf8").split("\n").forEach((line, index) => {
        for (const [utility] of line.matchAll(/focus(?:-within)?:border-hairline(?:\/\d+)?(?![\w-])/g)) {
          faint.push(`${relative(src, file)}:${index + 1} ${utility}`);
        }
      });
    }
    expect(faint).toEqual([]);
  });
});
