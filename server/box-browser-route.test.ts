import { describe, expect, it } from "vitest";
import { boxBrowserRoute, browserCallComputerResource } from "./box-browser-route.ts";

describe("boxBrowserRoute", () => {
  it("uses the container the turn mounted", () => {
    expect(boxBrowserRoute({ mountedForTurn: true, inTurn: true, ownCloudBox: true, teamComputer: false })).toBe("mounted");
  });
  it("keeps a bot without a VPS box on the host browser", () => {
    expect(boxBrowserRoute({ mountedForTurn: false, inTurn: true, ownCloudBox: false, teamComputer: false })).toBe("host");
  });
  it("gives a browser-pinned turn of a per-bot VPS computer its own box's Chromium instead of failing the turn", () => {
    expect(boxBrowserRoute({ mountedForTurn: false, inTurn: true, ownCloudBox: true, teamComputer: false })).toBe("own-box");
    expect(boxBrowserRoute({ mountedForTurn: false, inTurn: false, ownCloudBox: true, teamComputer: false })).toBe("own-box");
  });
  it("refuses a team computer turn that holds no screen lease", () => {
    expect(boxBrowserRoute({ mountedForTurn: false, inTurn: true, ownCloudBox: false, teamComputer: true })).toBe("refuse");
    expect(boxBrowserRoute({ mountedForTurn: false, inTurn: false, ownCloudBox: false, teamComputer: true })).toBe("shared-box");
  });
});

describe("browserCallComputerResource", () => {
  const own = "computer:vps:this-server:bot-1";
  it("holds the mounted computer, or the per-bot box a browser-pinned turn drives, so a person's control and other turns are respected", () => {
    expect(browserCallComputerResource({ mountedResource: "computer:vps:this-server:computer_x:screen:bot-1", ownBoxResource: own, ownCloudBox: false, teamComputer: true }))
      .toBe("computer:vps:this-server:computer_x:screen:bot-1");
    expect(browserCallComputerResource({ ownBoxResource: own, ownCloudBox: true, teamComputer: false })).toBe(own);
  });
  it("holds no computer for a host browser, and none for a team computer turn that is refused anyway", () => {
    expect(browserCallComputerResource({ ownBoxResource: own, ownCloudBox: false, teamComputer: false })).toBeUndefined();
    expect(browserCallComputerResource({ ownBoxResource: own, ownCloudBox: false, teamComputer: true })).toBeUndefined();
  });
});
