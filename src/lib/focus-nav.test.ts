import { describe, expect, it } from "vitest";
import { focusNavKey } from "./focus-nav";

describe("keyboard focus ring", () => {
  it("turns on for tab and arrow keys", () => {
    for (const key of ["Tab", "ArrowDown", "ArrowLeft", "Home", "End"]) expect(focusNavKey(key), key).toBe(true);
  });
  it("turns off for keys that act or type, so a dialog opened with enter shows no ring", () => {
    for (const key of ["Enter", " ", "Escape", "a"]) expect(focusNavKey(key), key).toBe(false);
  });
  it("leaves it as it was for a modifier, so shift-tab still shows it", () => {
    for (const key of ["Shift", "Meta"]) expect(focusNavKey(key), key).toBeNull();
  });
});
