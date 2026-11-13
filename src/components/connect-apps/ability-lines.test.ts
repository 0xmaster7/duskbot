import { describe, expect, it } from "vitest";

import { abilityLine, abilityLines } from "./ability-lines";

describe("what an app can do, in plain lines", () => {
  it("says api calls the way a person would", () => {
    expect(abilityLine("Get ACL Rule").text).toBe("See who can access a calendar");
    expect(abilityLine("List ACL Rules").text).toBe("See who can access a calendar");
    expect(abilityLine("Delete ACL Rule").text).toBe("Remove someone's access");
    expect(abilityLine("List Events").text).toBe("See all Events");
    expect(abilityLine("Patch Calendar List Entry").text).toBe("Change calendar in your list");
    expect(abilityLine("Insert Calendar into List").text).toBe("Add Calendar to your list");
    expect(abilityLine("Get Single Calendar by ID").text).toBe("See one Calendar");
  });

  it("puts the everyday ones first and the internals last, each said once", () => {
    const lines = abilityLines(["Delete ACL Rule", "Get ACL Rule", "List ACL Rules", "Watch Events", "Stop Channel", "Get Event", "Create Event", "List Events", "Delete event"]);
    expect(lines.slice(0, 3)).toEqual(["Create Event", "See all Events", "See Event"]);
    expect(lines.indexOf("See who can access a calendar")).toBeGreaterThan(lines.indexOf("Delete event"));
    expect(lines.filter((line) => line === "See who can access a calendar")).toHaveLength(1);
    expect(lines.slice(-2).sort()).toEqual(["Stop Channel", "Watch Events"]);
  });
});
