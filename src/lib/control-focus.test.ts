// Chromium matches :focus-visible on a pointer click, so styles.css drops the outline on text fields only (WCAG 2.4.7).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../styles.css"), "utf8");

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

const withoutComments = unlayered(css).replace(/\/\*[\s\S]*?\*\//g, "");

const outlineRemovers = [...withoutComments.matchAll(/([^{}]+)\{([^}]*)\}/g)]
  .filter(([, , body]) => /(?:^|;)\s*outline\s*:\s*(?:none|0)\s*(?:;|$)/.test(body))
  .map(([, selector]) => selector.trim());

const CONTROLS = ["checkbox", "radio", "range", "color", "file"];

describe("keyboard focus on form controls", () => {
  it("shows keyboard focus as a tint, never a ring", () => {
    expect(withoutComments).toMatch(/:focus-visible,[^{]*\{[^}]*outline-color:\s*transparent !important;[^}]*--tw-ring-color:\s*transparent !important/);
    expect(withoutComments).toMatch(/\[data-focus-nav\] :focus-visible[^{]*\{[^}]*background-image:/);
  });

  it("still takes the outline off text fields, so the composer pill stays clean", () => {
    const fieldRule = outlineRemovers.find((selector) => selector.includes("textarea"));
    expect(fieldRule).toBeDefined();
    expect(fieldRule).toContain("input");
  });

  it.each(CONTROLS)("never takes the outline off a %s input", (type) => {
    for (const selector of outlineRemovers) {
      for (const [compound] of selector.matchAll(/(?<![\w-])input(?![\w-])(?::not\((?:[^()]|\([^()]*\))*\))?/g)) {
        expect(compound, selector).toContain(`[type="${type}"]`);
      }
    }
  });

  it.each(CONTROLS)("gives a keyboard-focused %s input a halo, since the global rule clears its outline and it paints no tint", (type) => {
    const rule = /:root\[data-focus-nav\] input:is\(([^)]*)\):focus-visible\s*\{([^}]*)\}/.exec(unlayered(css));
    expect(rule).not.toBeNull();
    expect(rule![1]).toContain(`[type="${type}"]`);
    expect(rule![2]).toMatch(/box-shadow:\s*0 0 0 \d+px/);
  });
});
