import { describe, expect, it } from "vitest";
import type { CloudAccountState } from "../../electron/cloud-account.mjs";
import type { CloudListEntry } from "../../electron/cloud-list.mjs";
import type { KeepHereState } from "../../electron/cloud-send.mjs";
import { boatCloudHint, boatCloudOnCloud, boatCloudOnComputer } from "./boat-cloud";

const home = (over: Partial<CloudListEntry> = {}): CloudListEntry => ({
  id: "c-home", name: "Harbor", color: null, role: "owner", tier: "pro", runsOn: "cloud", status: "ready", origin: "https://home.example.test",
  teamId: null, primary: true, managed: true, provider: "boat", ...over,
});
const connected = (clouds: CloudListEntry[] | undefined, over: Partial<CloudAccountState> = {}): CloudAccountState => ({ status: "connected", ...(clouds ? { clouds } : {}), ...over });
const keep = (over: Partial<KeepHereState> = {}): KeepHereState => ({ shown: true, on: false, moved: false, coming: false, ...over });

describe("the Boat cloud row on this computer's page", () => {
  it("waits for the session, and offers a Cloud to anyone without one of their own", () => {
    expect(boatCloudOnComputer(undefined, null, null)).toBeNull();
    expect(boatCloudOnComputer({ status: "signed-out" }, null, null)).toEqual({ step: "get", acts: true });
    expect(boatCloudOnComputer(connected([]), null, null)).toEqual({ step: "get", acts: true });
    expect(boatCloudOnComputer(connected([home({ primary: false, role: "member", teamId: "t-1" })]), null, null)?.step).toBe("get");
  });

  it("never takes a Cloud the session doesn't say Boat runs for one", () => {
    expect(boatCloudOnComputer(connected([home({ provider: undefined })]), keep(), null)).toEqual({ step: "other", name: "Harbor", acts: false });
    expect(boatCloudOnComputer(connected(undefined, { machine: { status: "ready", origin: "https://home.example.test" } }), keep(), null)?.step).toBe("other");
  });

  it("follows the Cloud through checkout, setup and trouble", () => {
    expect(boatCloudOnComputer(connected([home({ status: "checkout", origin: null })]), null, null)).toEqual({ step: "finish", name: "Harbor", acts: true });
    expect(boatCloudOnComputer(connected([home({ status: "setting_up", origin: null })]), null, null)).toEqual({ step: "setup", name: "Harbor", acts: false });
    for (const status of ["payment_problem", "ended", "stopped"] as const) expect(boatCloudOnComputer(connected([home({ status })]), keep(), null)?.step).toBe("manage");
  });

  it("moves this computer's bots there once it's ready, asleep or not, and opens it once they are there", () => {
    const asleep = home({ power: { state: "asleep", since: 1, sleeps: true } });
    expect(boatCloudOnComputer(connected([asleep]), keep(), null)).toEqual({ step: "move", name: "Harbor", acts: true });
    expect(boatCloudOnComputer(connected([home()]), keep({ on: true }), null)?.step).toBe("move");
    expect(boatCloudOnComputer(connected([home()]), keep({ moved: true }), null)?.step).toBe("open");
    expect(boatCloudOnComputer(connected([home()]), keep({ shown: false }), null)?.step).toBe("open");
    // an older desktop without the switch only opens it
    expect(boatCloudOnComputer(connected([home()]), null, null)?.step).toBe("open");
    expect(boatCloudOnComputer(connected([home({ status: "offline" })]), keep(), null)?.step).toBe("move");
  });

  it("says where a move stands while it runs", () => {
    expect(boatCloudOnComputer(connected([home()]), keep(), { phase: "copy" })).toEqual({ step: "moving", name: "Harbor", acts: false });
    expect(boatCloudOnComputer(connected([home()]), keep(), { phase: "wait" })?.step).toBe("moving");
    // a move to a server of their own is not this one
    expect(boatCloudOnComputer(connected([home()]), keep(), { phase: "copy", place: "Garage" })?.step).toBe("move");
    expect(boatCloudOnComputer(connected([home()]), keep({ moved: true, coming: true }), null)?.step).toBe("coming-back");
    expect(boatCloudOnComputer(connected([home()], { waking: true }), keep({ moved: true }), null)?.step).toBe("waking");
  });
});

describe("the Boat cloud row on the Cloud's own page", () => {
  it("is there only on a Boat cloud holding this computer's bots, to move them back", () => {
    expect(boatCloudOnCloud(null, keep({ moved: true }))).toBeNull();
    expect(boatCloudOnCloud({ status: "paid" }, keep({ moved: true }))).toBeNull();
    expect(boatCloudOnCloud({ status: "paid", provider: "boat" }, null)).toBeNull();
    expect(boatCloudOnCloud({ status: "paid", provider: "boat" }, keep())).toBeNull();
    expect(boatCloudOnCloud({ status: "paid", provider: "boat" }, keep({ moved: true }))).toEqual({ step: "back", acts: true });
    expect(boatCloudOnCloud({ status: "paid", provider: "boat" }, keep({ moved: true, coming: true }))).toEqual({ step: "coming-back", acts: false });
  });

  it("words every step without a placeholder left in", () => {
    for (const step of ["get", "finish", "setup", "manage", "other", "waking", "move", "moving", "open", "back", "coming-back"] as const) {
      expect(boatCloudHint(step)).not.toMatch(/\{\w+\}|^place\./);
    }
  });
});
