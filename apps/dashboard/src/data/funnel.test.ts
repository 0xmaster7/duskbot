import { expect, test } from "vitest";
import { fixtureCatalog } from "./fixtures";
import { freeTradeoffs, planLine } from "./funnel";
import { bundleOf, desktopOf } from "./pricing";

test("the free comparison reads the machine from the catalog, never a fixed number", () => {
  const catalog = structuredClone(fixtureCatalog);
  const desk = desktopOf(catalog, bundleOf(catalog, "starter")!.desktop)!;
  Object.assign(desk, { vcpu: 6, ramGb: 12, botComputers: 3 });
  const machine = freeTradeoffs(catalog, "starter").find((r) => r.topic === "bot computers")!;
  expect(machine.paid).toBe("3 bot computers on 6 vcpu and 12 gb ram of their own");
});

test("only a plan with a work license adds the work row", () => {
  const plus = bundleOf(fixtureCatalog, "starter")!;
  const pro = bundleOf(fixtureCatalog, "pro")!;
  expect(freeTradeoffs(fixtureCatalog, "starter").some((r) => r.topic === "work use")).toBe(plus.license !== "personal");
  expect(freeTradeoffs(fixtureCatalog, "pro").some((r) => r.topic === "work use")).toBe(pro.license !== "personal");
  expect(planLine(fixtureCatalog, "pro")).toBe("5 bot computers, priority wake, work license");
  expect(planLine(fixtureCatalog, "starter")).toBe("2 bot computers");
});
