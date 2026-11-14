import { describe, expect, it } from "vitest";

import { addressParts, foldTabs, minutesSince, pageTitle, parseLocalBrowser, tabLetter } from "./local-browser";

describe("local browser", () => {
  it("reads the server's answer, giving each kept screen its own address", () => {
    expect(parseLocalBrowser({ open: false, closed: { at: 5, tabs: [{ title: "Docs", url: "https://example.com/", image: true }, { title: "", url: "https://iana.org/", image: false }, { url: 3 }] } }, "b1", "t1"))
      .toEqual({ open: false, closed: { at: 5, tabs: [
        { title: "Docs", url: "https://example.com/", image: "/api/bots/b1/browser/recent/0?threadId=t1&at=5" },
        { title: "", url: "https://iana.org/", image: null },
      ] } });
    expect(parseLocalBrowser({ open: true, closed: null }, "b1", undefined)).toEqual({ open: true, closed: null });
    expect(parseLocalBrowser(null, "b1", undefined)).toEqual({ open: false, closed: null });
  });

  it("folds tabs past the strip into a count, keeping the shown tab in view", () => {
    const tabs = ["t1", "t2", "t3", "t4"].map((tabId) => ({ tabId }));
    expect(foldTabs(tabs, "t1", 2)).toEqual({ shown: [{ tabId: "t1" }, { tabId: "t2" }], hidden: 2 });
    expect(foldTabs(tabs, "t4", 2)).toEqual({ shown: [{ tabId: "t1" }, { tabId: "t4" }], hidden: 2 });
    expect(foldTabs(tabs.slice(0, 2), "t2", 2)).toEqual({ shown: tabs.slice(0, 2), hidden: 0 });
  });

  it("names a page by its site", () => {
    expect(addressParts("https://www.paypal.com/invoice/create?id=1")).toEqual({ host: "paypal.com", rest: "/invoice/create?id=1" });
    expect(tabLetter("Log in", "https://wise.com/login")).toBe("W");
    expect(tabLetter("Notes", "about:blank")).toBe("N");
    expect(pageTitle("en.wikipedia.org/wiki/Cat", "https://en.wikipedia.org/wiki/Cat")).toBe("");
    expect(pageTitle("example.com", "https://example.com/")).toBe("");
    expect(pageTitle("Cat - Wikipedia", "https://en.wikipedia.org/wiki/Cat")).toBe("Cat - Wikipedia");
    expect(minutesSince(0, 4 * 60_000 + 59_000)).toBe(4);
  });
});
