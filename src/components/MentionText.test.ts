import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { MentionText } from "./MentionText";
import { MAUS_COLORS } from "@/lib/mascot";

it("uses each bot's avatar palette and updates when its color changes", () => {
  for (const color of ["red", "blue"] as const) {
    const html = renderToStaticMarkup(createElement(MentionText, {
      text: "@Atlas @Juniper @everyone", everyone: true,
      peers: [{ name: "Atlas", color }, { name: "Juniper", color: "purple" }],
    }));
    expect(html).toContain(`style="--mention-color:${MAUS_COLORS[color]}">@Atlas`);
    expect(html).toContain(`style="--mention-color:${MAUS_COLORS.purple}">@Juniper`);
    expect(html).toContain('<span class="mention-highlight">@everyone</span>');
  }
});

it("decorates known names while preserving whitespace and escaping text", () => {
  const html = renderToStaticMarkup(createElement(MentionText, {
    text: "<script>\n@Atlas & @Ghost\n@Atlas", peers: [{ name: "Atlas" }],
  }));
  expect(html).toBe('&lt;script&gt;\n<span class="mention-highlight">@Atlas</span> &amp; @Ghost\n<span class="mention-highlight">@Atlas</span>');
});

it("removes decoration when a peer is renamed or archived", () => {
  for (const peers of [[{ name: "Renamed" }], [{ name: "Atlas", hidden: true }]]) {
    expect(renderToStaticMarkup(createElement(MentionText, { text: "@Atlas", peers }))).toBe("@Atlas");
  }
});

it("marks web addresses as pills, a link in a sent message and paint only in the composer", () => {
  const props = { text: "try example.com/@Atlas or @Atlas", peers: [{ name: "Atlas" }] };
  const open = renderToStaticMarkup(createElement(MentionText, { ...props, links: "open" }));
  expect(open).toBe('try <a href="https://example.com/@Atlas" target="_blank" rel="noreferrer" dir="ltr" class="link-pill">example.com/@Atlas</a> or <span class="mention-highlight">@Atlas</span>');
  const painted = renderToStaticMarkup(createElement(MentionText, { ...props, links: "highlight" }));
  expect(painted).toContain('<span class="link-pill">example.com/@Atlas</span>');
  expect(renderToStaticMarkup(createElement(MentionText, props))).not.toContain("link-pill");
});
