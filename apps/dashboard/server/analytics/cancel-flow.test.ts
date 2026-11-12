import { expect, it } from "vitest";
import { cancelFlowSummary } from "./cancel-flow.ts";

it("counts cancel flow starts, saves and cancels per reason inside the window, most cancels first", () => {
  const at = 1000;
  const summary = cancelFlowSummary([
    { reason: "price", step: "reason", outcome: "shown", at },
    { reason: "price", step: "help", outcome: "discount", at },
    { reason: "broken", step: "reason", outcome: "shown", at },
    { reason: "broken", step: "help", outcome: "helped", at },
    { reason: "broken", step: "confirm", outcome: "cancelled", at },
    { reason: "switching", step: "confirm", outcome: "cancelled", at },
    { reason: "switching", step: "confirm", outcome: "cancelled", at: 5000 },
    { reason: "unused", step: "reason", outcome: "shown", at: 10 },
  ], 500, 2000);
  expect(summary).toEqual({ started: 2, saved: 2, cancelled: 2, discounts: 1, reasons: [
    { reason: "broken", started: 1, saved: 1, cancelled: 1 },
    { reason: "switching", started: 0, saved: 0, cancelled: 1 },
    { reason: "price", started: 1, saved: 1, cancelled: 0 },
  ] });
});
