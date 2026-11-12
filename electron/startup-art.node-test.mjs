import assert from "node:assert/strict";
import test from "node:test";
import { LOGO } from "../build/logo.mjs";
import { LOGO_GRID } from "./startup-art.mjs";

test("the startup card's logo is the brand logo, cell for cell", () => {
  assert.deepEqual(LOGO_GRID, LOGO);
});
