import { expect, it } from "vitest";

import en from "./en.json";

// Deleting or replacing a Local VM keeps its durable folder and website sign-ins (Firefox's profile moves there first), and
// deletes what lived only inside the desktop. Every confirm says both, plainly.
const CONFIRMS = ["vm.confirm.deleteShared", "vm.confirm.recreate", "vm.confirm.deleteBotVm", "computer.confirm.replaceVm"] as const;

it("says what survives deleting or replacing a Local VM and what does not", () => {
  for (const key of CONFIRMS) {
    expect(en[key], key).toContain("its durable folder and website sign-ins are kept.");
    expect(en[key], key).toContain("apps installed inside the desktop and files outside the durable folder are deleted.");
  }
});
