import { describe, expect, it } from "vitest";
import { dismissKey, elsewhereCovered, elsewhereScreen, emptyHere, parseElsewhereView, SIMULATED_FRESH_INSTALL } from "./bots-elsewhere";

const VPS = { id: "srv", name: "my-vps", why: "moved" as const };
const TEAM = { id: "team", name: "Studio", why: "team" as const };

describe("bots elsewhere", () => {
  it("counts only the person's own bots: Dusk and bots off the sidebar leave a place empty", () => {
    expect(emptyHere([])).toBe(true);
    expect(emptyHere([{ defaultBot: { person: "" } }, { hidden: true }])).toBe(true);
    expect(emptyHere([{ defaultBot: { person: "" } }, {}])).toBe(false);
  });

  it("an empty page with bots elsewhere names the likeliest place, never a blank first run", () => {
    const view = { places: [VPS, TEAM], known: null };
    expect(elsewhereScreen({ view, empty: true, dismissed: [] })).toEqual({ kind: "bots-on", place: VPS, others: [TEAM] });
    expect(elsewhereScreen({ view, empty: false, dismissed: [] })).toBeNull();
    expect(elsewhereScreen({ view: null, empty: true, dismissed: [] })).toBeNull();
    expect(elsewhereScreen({ view: { places: [], known: null }, empty: true, dismissed: [] })).toBeNull();
  });

  it("a fresh install whose account set up elsewhere offers to connect, until the person starts here instead", () => {
    const screen = elsewhereScreen({ view: SIMULATED_FRESH_INSTALL, empty: true, dismissed: [] });
    expect(screen).toEqual({ kind: "set-up-on", setup: { kind: "server", name: "My VPS" } });
    expect(elsewhereScreen({ view: SIMULATED_FRESH_INSTALL, empty: true, dismissed: [dismissKey(screen!)] })).toBeNull();
    const bots = elsewhereScreen({ view: { places: [VPS], known: null }, empty: true, dismissed: [] })!;
    expect(elsewhereScreen({ view: { places: [VPS], known: null }, empty: true, dismissed: [dismissKey(bots)] })).toBeNull();
    expect(elsewhereScreen({ view: { places: [TEAM], known: null }, empty: true, dismissed: [dismissKey(bots)] })?.kind).toBe("bots-on");
  });

  it("takes only well-formed places from main", () => {
    expect(parseElsewhereView({ places: [VPS, { id: 1 }, { id: "x", name: " ", why: "server" }, { id: "y", name: "Y", why: "moon" }], known: { kind: "phone", name: "x" } }))
      .toEqual({ places: [VPS], known: null });
    expect(parseElsewhereView(null)).toEqual({ places: [], known: null });
  });

  it("steps aside for the sheets its ways out open, so connect a server shows Settings rather than this screen", () => {
    const none = { settings: false, cloudAdd: false, addVps: false, cloudMove: false };
    expect(elsewhereCovered(none)).toBe(false);
    expect(elsewhereCovered({ ...none, settings: true })).toBe(true);
    expect(elsewhereCovered({ ...none, cloudAdd: true })).toBe(true);
    expect(elsewhereCovered({ ...none, addVps: true })).toBe(true);
    expect(elsewhereCovered({ ...none, cloudMove: true })).toBe(true);
  });
});
