import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PRODUCT_NAME, productName } from "./brand";

describe("product name", () => {
  it("uses MausBot", () => {
    expect(productName()).toBe("MausBot");
  });

  it.each(["index.html", "rail.html"])("%s starts with the product name", (page) => {
    const html = readFileSync(new URL(`../../${page}`, import.meta.url), "utf8");
    expect(html).toContain(`<title>${PRODUCT_NAME}</title>`);
  });
});
