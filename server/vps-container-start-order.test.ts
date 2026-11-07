import { expect, it } from "vitest";
import { compareVpsContainerStarts } from "./vps-container-start.ts";

it.each<[string, string, number]>([
  ["2026-11-07T00:00:00.000000001Z", "2026-11-07T00:00:00.000000002Z", -1],
  ["2026-11-07T00:00:00.000000002Z", "2026-11-07T00:00:00.000000001Z", 1],
  ["2026-11-07T00:00:00Z", "2026-11-07T00:00:00.000000000Z", 0],
  ["2026-11-07T00:00:00.1Z", "2026-11-07T00:00:00.100000000Z", 0],
  ["2026-11-07T00:00:01Z", "2026-11-07T00:00:00.999999999Z", 1],
])("orders boot receipts %s and %s without discarding nanoseconds", (left, right, order) => {
  expect(compareVpsContainerStarts(left, right)).toBe(order);
});

it("rejects malformed boot receipts", () => {
  expect(() => compareVpsContainerStarts("invalid", "2026-11-07T00:00:00Z")).toThrow(/Invalid/);
});
