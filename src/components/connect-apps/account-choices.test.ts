import { describe, expect, it } from "vitest";

import { defaultAccount, nextAccountName } from "./account-choices";
import { plainConnectError } from "./connector-helpers";

const status = (accounts: Array<{ id: string; alias?: string; status: string }>) => ({ connected: true, pending: false, status: "ACTIVE", accounts });

describe("accounts", () => {
  it("names the next account with the first free number", () => {
    expect(nextAccountName([{ id: "a", status: "ACTIVE" }], "account")).toBe("account 2");
    expect(nextAccountName([{ id: "a", status: "ACTIVE" }, { id: "b", alias: "account 3", status: "ACTIVE" }], "account")).toBe("account 4");
  });

  it("uses the stored default while it is active, else the earliest active account", () => {
    const two = status([{ id: "new", status: "ACTIVE" }, { id: "old", status: "ACTIVE" }, { id: "gone", status: "EXPIRED" }]);
    expect(defaultAccount(two, "new")?.id).toBe("new");
    expect(defaultAccount(two, "gone")?.id).toBe("old");
    expect(defaultAccount(two, undefined)?.id).toBe("old");
  });
});

describe("plainConnectError", () => {
  it("turns technical failures into short sentences of ours", () => {
    expect(plainConnectError("Connected apps: HTTP 502")).toEqual({ key: "connectors.connectFailed" });
    expect(plainConnectError("The connected-apps service is unavailable")).toEqual({ key: "connectors.connectFailed" });
    expect(plainConnectError("gmail already has the maximum of 5 accounts")).toEqual({ key: "connectors.tooManyAccounts" });
    expect(plainConnectError("too many registration attempts")).toEqual({ key: "connectors.tooManyTries" });
    expect(plainConnectError("This app is blocked by your organization.")).toBe("This app is blocked by your organization.");
  });
});
