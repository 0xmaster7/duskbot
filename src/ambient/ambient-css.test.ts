// The rules the surfaces cannot do without, checked in the stylesheet itself (DOM tests run without it).
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const css = readFileSync(new URL("./ambient.css", import.meta.url), "utf8");
const rule = (selector: string) => {
  const at = css.indexOf(`${selector} {`);
  return at < 0 ? "" : css.slice(at, css.indexOf("}", at));
};

it("keeps the gliding highlight out of the rows' flow and out of the way of every click", () => {
  const band = rule(".amb-band");
  expect(band).toContain("position: absolute");
  expect(band).toContain("pointer-events: none");
});

it("keeps a focused reply field's border as it was", () => {
  expect(css).not.toMatch(/\.amb-reply:focus-within\s*\{/);
});
