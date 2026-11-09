import { describe, expect, it } from "vitest";
import type { CloudAccountState } from "../../electron/cloud-account.mjs";
import type { CloudListEntry } from "../../electron/cloud-list.mjs";
import type { KeepHereState } from "../../electron/cloud-send.mjs";
import { cloudDesktopHint, cloudDesktopOnCloud, cloudDesktopOnComputer } from "./cloud-desktop";

const home = (over: Partial<CloudListEntry> = {}): CloudListEntry => ({
  id: "c-home", name: "Harbor", color: null, role: "owner", tier: "pro", runsOn: "cloud", status: "ready", origin: "https://home.example.test",
  teamId: null, primary: true, managed: true, provider: "managed", ...over,
});
const connected = (clouds: CloudListEntry[] | undefined, over: Partial<CloudAccountState> = {}): CloudAccountState => ({ status: "connected", ...(clouds ? { clouds } : {}), ...over });
const keep = (over: Partial<KeepHereState> = {}): KeepHereState => ({ shown: true, on: false, moved: false, coming: false, ...over });

describe("the cloud desktop row on this computer's page", () => {
  it("waits for the session, and offers a Cloud to anyone without one of their own", () => {
    expect(cloudDesktopOnComputer(undefined, null, null)).toBeNull();
    expect(cloudDesktopOnComputer({ status: "signed-out" }, null, null)).toEqual({ step: "get", acts: true });
    expect(cloudDesktopOnComputer(connected([]), null, null)).toEqual({ step: "get", acts: true });
    expect(cloudDesktopOnComputer(connected([home({ primary: false, role: "member", teamId: "t-1" })]), null, null)?.step).toBe("get");
  });

  it("never takes a Cloud the session doesn't say a managed provider runs for one", () => {
    expect(cloudDesktopOnComputer(connected([home({ provider: undefined })]), keep(), null)).toEqual({ step: "other", name: "Harbor", acts: false });
    expect(cloudDesktopOnComputer(connected(undefined, { machine: { status: "ready", origin: "https://home.example.test" } }), keep(), null)?.step).toBe("other");
  });

  it("follows the Cloud through checkout, setup and trouble", () => {
    expect(cloudDesktopOnComputer(connected([home({ status: "checkout", origin: null })]), null, null)).toEqual({ step: "finish", name: "Harbor", acts: true });
    expect(cloudDesktopOnComputer(connected([home({ status: "setting_up", origin: null })]), null, null)).toEqual({ step: "setup", name: "Harbor", acts: false });
    for (const status of ["payment_problem", "ended", "stopped"] as const) expect(cloudDesktopOnComputer(connected([home({ status })]), keep(), null)?.step).toBe("manage");
  });

  it("moves this computer's bots there once it's ready, asleep or not, and opens it once they are there", () => {
    const asleep = home({ power: { state: "asleep", since: 1, sleeps: true } });
    expect(cloudDesktopOnComputer(connected([asleep]), keep(), null)).toEqual({ step: "move", name: "Harbor", acts: true });
    expect(cloudDesktopOnComputer(connected([home()]), keep({ on: true }), null)?.step).toBe("move");
    expect(cloudDesktopOnComputer(connected([home()]), keep({ moved: true }), null)?.step).toBe("open");
    expect(cloudDesktopOnComputer(connected([home()]), keep({ shown: false }), null)?.step).toBe("open");
    // an older desktop without the switch only opens it
    expect(cloudDesktopOnComputer(connected([home()]), null, null)?.step).toBe("open");
    expect(cloudDesktopOnComputer(connected([home({ status: "offline" })]), keep(), null)?.step).toBe("move");
  });

  it("says where a move stands while it runs", () => {
    expect(cloudDesktopOnComputer(connected([home()]), keep(), { phase: "copy" })).toEqual({ step: "moving", name: "Harbor", acts: false });
    expect(cloudDesktopOnComputer(connected([home()]), keep(), { phase: "wait" })?.step).toBe("moving");
    // a move to a server of their own is not this one
    expect(cloudDesktopOnComputer(connected([home()]), keep(), { phase: "copy", place: "Garage" })?.step).toBe("move");
    expect(cloudDesktopOnComputer(connected([home()]), keep({ moved: true, coming: true }), null)?.step).toBe("coming-back");
    expect(cloudDesktopOnComputer(connected([home()], { waking: true }), keep({ moved: true }), null)?.step).toBe("waking");
  });
});

describe("the cloud desktop row on the Cloud's own page", () => {
  it("is there only on a cloud desktop holding this computer's bots, to move them back", () => {
    expect(cloudDesktopOnCloud(null, keep({ moved: true }))).toBeNull();
    expect(cloudDesktopOnCloud({ status: "paid" }, keep({ moved: true }))).toBeNull();
    expect(cloudDesktopOnCloud({ status: "paid", provider: "managed" }, null)).toBeNull();
    expect(cloudDesktopOnCloud({ status: "paid", provider: "managed" }, keep())).toBeNull();
    expect(cloudDesktopOnCloud({ status: "paid", provider: "managed" }, keep({ moved: true }))).toEqual({ step: "back", acts: true });
    expect(cloudDesktopOnCloud({ status: "paid", provider: "managed" }, keep({ moved: true, coming: true }))).toEqual({ step: "coming-back", acts: false });
  });

  it("words every step without a placeholder left in", () => {
    for (const step of ["get", "finish", "setup", "manage", "other", "waking", "move", "moving", "open", "back", "coming-back"] as const) {
      expect(cloudDesktopHint(step)).not.toMatch(/\{\w+\}|^place\./);
    }
  });
});
