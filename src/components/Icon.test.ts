import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ICONS, Icon, type IconName } from "./Icon";

const names = Object.keys(ICONS) as IconName[];

describe("Icon", () => {
  it("draws every named icon as a sized svg", () => {
    for (const name of names) {
      const html = renderToStaticMarkup(createElement(Icon, { name, size: 14 }));
      expect(html, name).toMatch(new RegExp(`^<svg [^>]*width="14" height="14"[^>]*class="[^"]*\\bui-icon\\b[^"]*" data-icon-name="${name}"`));
      expect(html, name).toContain('aria-hidden="true"');
    }
  });

  it("takes the named sizes and an accessible name", () => {
    const html = renderToStaticMarkup(createElement(Icon, { name: "search", size: "xl", "aria-label": "Search" }));
    expect(html).toContain('width="20"');
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Search"');
    expect(html).not.toContain("aria-hidden");
  });

  it("draws the solid twin when filled, and a heavier outline where there is none", () => {
    const outline = renderToStaticMarkup(createElement(Icon, { name: "play" }));
    const solid = renderToStaticMarkup(createElement(Icon, { name: "play", variant: "filled" }));
    expect(solid).toContain('data-icon-fill="solid"');
    expect(solid.match(/ d="([^"]+)"/)?.[1]).not.toBe(outline.match(/ d="([^"]+)"/)?.[1]);
    expect(renderToStaticMarkup(createElement(Icon, { name: "info", variant: "filled" }))).toContain('data-icon-fill="solid"');
    const heavy = renderToStaticMarkup(createElement(Icon, { name: "arrow-up", variant: "filled" }));
    expect(heavy).toContain('data-icon-fill="bold"');
    expect(heavy).toContain('viewBox="0 0 16 16"');
  });
});
