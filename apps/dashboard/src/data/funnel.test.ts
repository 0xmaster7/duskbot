import { expect, test } from "vitest";
import { fixtureCatalog } from "./fixtures";
import { freeTradeoffs, planLine } from "./funnel";
import { bundleOf, desktopOf } from "./pricing";

test("the free comparison reads the machine from the catalog, never a fixed number", () => {
  const catalog = structuredClone(fixtureCatalog);
  const desk = desktopOf(catalog, bundleOf(catalog, "starter")!.desktop)!;
  Object.assign(desk, { vcpu: 6, ramGb: 12, diskGb: 30 });
  const machine = freeTradeoffs(catalog, "starter").find((r) => r.topic === "machine")!;
  expect(machine.paid).toBe("6 vcpu, 12 gb ram and 30 gb disk of their own");
});

test("only a plan with a work license adds the work row", () => {
  const plus = bundleOf(fixtureCatalog, "starter")!;
  const pro = bundleOf(fixtureCatalog, "pro")!;
  expect(freeTradeoffs(fixtureCatalog, "starter").some((r) => r.topic === "work use")).toBe(plus.license !== "personal");
  expect(freeTradeoffs(fixtureCatalog, "pro").some((r) => r.topic === "work use")).toBe(pro.license !== "personal");
  expect(planLine(fixtureCatalog, "pro")).toBe("4 vcpu · 8 gb ram · 60 gb, priority wake, work license");
  expect(planLine(fixtureCatalog, "starter")).toBe("2 vcpu · 4 gb ram · 20 gb");
});
