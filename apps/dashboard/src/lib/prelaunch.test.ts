import { describe, expect, it } from "vitest";
import { prelaunchAllowed, type PrelaunchFlows } from "./prelaunch";

const none: PrelaunchFlows = { handoff: false, claim: false, deleting: () => false };
const allowed = (to: string, flows = none) => { const url = new URL(to, "http://x"); return prelaunchAllowed(url.pathname, url.searchParams, flows); };

describe("before launch", () => {
  it("sends every dashboard screen and a bare flow page to the waitlist", () => {
    for (const to of ["/", "/billing", "/account", "/cloud", "/bots/b1", "/welcome", "/signup", "/sign-in", "/signin", "/cloud/desktop", "/handoff", "/app-signed-in", "/claim",
      "/clouds/c1/delete", "/sign-in?next=/billing", "/sign-in?next=//evil.test", "/sign-in?next=/claim", "/sign-in?next=/sign-in?attempt=a", "/admin", "/admin/people", "/sign-in?next=/admin"]) expect([to, allowed(to)]).toEqual([to, false]);
  });
  it("keeps a real flow's pages: the app's sign-in code, an emailed link, a handoff, claim or delete token", () => {
    const flows: PrelaunchFlows = { handoff: true, claim: true, deleting: (id) => id === "c1", appReturn: true };
    for (const to of ["/cloud/desktop?code=ABCDE-FGHJK", "/sign-in?next=%2Fcloud%2Fdesktop%3Fcode%3DABCDE-FGHJK", "/sign-in?attempt=a"]) expect([to, allowed(to)]).toEqual([to, true]);
    for (const to of ["/handoff", "/app-signed-in", "/claim", "/clouds/c1/delete", "/sign-in?next=/claim", "/sign-in?error=oauth_denied&next=/clouds/c1/delete"]) expect([to, allowed(to, flows)]).toEqual([to, true]);
    expect(allowed("/team/join", flows)).toBe(false);
    expect(allowed("/team/join", { ...flows, teamInvite: true })).toBe(true);
    expect(allowed("/team", { ...flows, teamInvite: true })).toBe(false);
    expect(allowed("/clouds/c2/delete", flows)).toBe(false);
    expect(allowed("/billing", flows)).toBe(false);
  });
});
