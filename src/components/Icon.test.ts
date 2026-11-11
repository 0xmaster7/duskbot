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

  it("fills solid shapes and cuts the mark out of filled discs", () => {
    expect(renderToStaticMarkup(createElement(Icon, { name: "play", variant: "filled" }))).toContain('fill="currentColor"');
    expect(renderToStaticMarkup(createElement(Icon, { name: "info", variant: "filled" }))).toContain('data-icon-fill="knockout"');
    expect(renderToStaticMarkup(createElement(Icon, { name: "arrow-up", variant: "filled" }))).toContain('stroke-width="2.25"');
  });
});
