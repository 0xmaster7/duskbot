import { describe, expect, it } from "vitest";
import { formatEvent, matches, parseArgs, parseWhen } from "./trail.mjs";

describe("scripts/trail.mjs", () => {
  it("reads relative and absolute times", () => {
    const now = Date.parse("2026-11-14T10:00:00Z");
    expect(parseWhen("10m", now)).toBe(now - 600_000);
    expect(parseWhen("1d", now)).toBe(now - 86_400_000);
    expect(parseWhen("2026-11-14T09:00:00Z", now)).toBe(Date.parse("2026-11-14T09:00:00Z"));
    expect(() => parseWhen("soon", now)).toThrow();
  });

  it("filters by event prefix, grep and correlation id, nested ones too", () => {
    const takeover = { ts: "t", ev: "takeover.start", src: "renderer", cid: "abc123", link: { path: "direct", via: "ssh" } };
    expect(matches(takeover, { grep: "takeover" })).toBe(true);
    expect(matches(takeover, { ev: "link." })).toBe(false);
    expect(matches(takeover, { cid: "abc123" })).toBe(true);
    expect(matches({ ev: "http.req", cid: "abc123" }, { cid: "abc123" })).toBe(true);
    expect(matches({ ev: "http.req", cid: "zzz" }, { cid: "abc123" })).toBe(false);
  });

  it("prints the path first", () => {
    const line = formatEvent({ ts: "2026-11-14T10:00:01.234Z", ev: "takeover.start", src: "renderer", run: "r", bot: "b1", ok: true, link: { place: "linked", path: "relay", via: "relay" } });
    expect(line).toContain("takeover.start");
    expect(line.indexOf("link={place=linked path=relay via=relay}")).toBeLessThan(line.indexOf("ok=true"));
    expect(line).not.toContain("run=");
  });

  it("refuses unknown arguments", () => {
    expect(() => parseArgs(["--nope"])).toThrow(/unknown argument/);
    expect(parseArgs(["--since", "10m", "--grep", "takeover", "--last", "1"])).toMatchObject({ since: "10m", grep: "takeover", last: 1 });
  });
});
