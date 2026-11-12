import { afterEach, describe, expect, it, vi } from "vitest";

import { botShowsUnread, botUnreadCount, showBrowserUnread, titleWithUnread } from "./bot-unread";

describe("what one bot adds to the unread count", () => {
  it("adds one while it shows unread, and nothing once read, as it always did", () => {
    expect(botUnreadCount({ tasks: [{ unread: true }, { unread: true }] })).toBe(1);
    expect(botUnreadCount({ unread: true })).toBe(1);
    expect(botUnreadCount({ tasks: [{ unread: false }] })).toBe(0);
  });

  it("adds each ask waiting on the person in their inbox, read or not, and drops them as they are settled", () => {
    expect(botUnreadCount({ tasks: [{ unread: true, openAsks: 3 }] })).toBe(3);
    expect(botUnreadCount({ tasks: [{ unread: false, openAsks: 2 }] })).toBe(2);
    expect(botUnreadCount({ tasks: [{ unread: true, openAsks: 1 }] })).toBe(1);
    expect(botUnreadCount({ tasks: [{ unread: false }] }), "all settled").toBe(0);
  });
});

describe("a bot's unread dot", () => {
  const bot = (main: boolean, work: boolean, threadId = "main") => ({ threadId, mainThreadId: "main", unread: main || work,
    tasks: [{ threadId: "main", unread: main }, { threadId: "work", unread: work }] });

  it("is about the one conversation its chat shows, its main thread, so opening that chat clears it", () => {
    expect(botShowsUnread(bot(true, false))).toBe(true);
    expect(botShowsUnread(bot(false, true)), "an unread line in a thread the person cannot see").toBe(false);
    expect(botShowsUnread(bot(false, true, "work")), "while another thread is current").toBe(false);
  });

  it("falls back to its current thread, then to any thread, when it names no main one", () => {
    expect(botShowsUnread({ threadId: "work", tasks: [{ threadId: "main", unread: true }, { threadId: "work", unread: false }] })).toBe(false);
    expect(botShowsUnread({ tasks: [{ threadId: "main", unread: true }] })).toBe(true);
  });
});

describe("browser unread indicator", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("prefixes the title with the count, replaces an older count, and drops it at zero", () => {
    expect(titleWithUnread("dusk bot", 3)).toBe("(3) dusk bot");
    expect(titleWithUnread("(3) dusk bot", 5)).toBe("(5) dusk bot");
    expect(titleWithUnread("(5) Acme", 0)).toBe("Acme");
    expect(titleWithUnread("Acme", 0)).toBe("Acme");
  });

  it("sets the title and the app badge, and clears both", () => {
    const doc = { title: "dusk bot" };
    const setAppBadge = vi.fn(async () => {});
    const clearAppBadge = vi.fn(async () => {});
    vi.stubGlobal("document", doc);
    vi.stubGlobal("navigator", { setAppBadge, clearAppBadge });

    showBrowserUnread(2);
    expect(doc.title).toBe("(2) dusk bot");
    expect(setAppBadge).toHaveBeenCalledWith(2);

    showBrowserUnread(0);
    expect(doc.title).toBe("dusk bot");
    expect(clearAppBadge).toHaveBeenCalled();
  });

  it("keeps the page's own title, such as a white-label name or a preview page's", () => {
    const doc = { title: "Isolated dusk bot Chat" };
    vi.stubGlobal("document", doc);
    vi.stubGlobal("navigator", {});
    showBrowserUnread(0);
    expect(doc.title).toBe("Isolated dusk bot Chat");
    showBrowserUnread(1);
    expect(doc.title).toBe("(1) Isolated dusk bot Chat");
  });

  it("still sets the title where the Badging API is missing or refuses", () => {
    const doc = { title: "dusk bot" };
    vi.stubGlobal("document", doc);
    vi.stubGlobal("navigator", {});
    showBrowserUnread(1);
    expect(doc.title).toBe("(1) dusk bot");

    vi.stubGlobal("navigator", { setAppBadge: () => Promise.reject(new Error("NotAllowedError")) });
    showBrowserUnread(4);
    expect(doc.title).toBe("(4) dusk bot");
  });
});
