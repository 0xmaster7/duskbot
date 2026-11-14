import { describe, expect, it } from "vitest";
import { markTemplatesHandoff, takeTemplatesHandoff } from "./SidebarTemplates";

describe("templates handoff", () => {
  it("is taken once, by the Templates that opens after another dialog", () => {
    expect(takeTemplatesHandoff()).toBe(false);
    markTemplatesHandoff();
    expect(takeTemplatesHandoff()).toBe(true);
    expect(takeTemplatesHandoff()).toBe(false);
  });
});
