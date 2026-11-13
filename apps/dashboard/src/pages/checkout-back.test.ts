import { expect, it } from "vitest";
import { backFromCheckout } from "./Billing";

it("reads dodo's return status only when it came back from a payment page", () => {
  const q = (s: string) => backFromCheckout(new URLSearchParams(s));
  expect(q("subscription_id=sub_1&status=pending")).toBe("pending");
  expect(q("payment_id=pay_1&status=processing")).toBe("pending");
  expect(q("subscription_id=sub_1&status=failed")).toBe("failed");
  expect(q("subscription_id=sub_1&status=active")).toBeNull();
  expect(q("status=pending")).toBeNull();
  expect(q("plan=pro")).toBeNull();
});
