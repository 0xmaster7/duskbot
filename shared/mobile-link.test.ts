import { describe, expect, it } from "vitest";
import { appLinkFromUniversal, MOBILE_LINK_VERSION, mobileLinkUrl, mobileOpenLink, parseMobileOpenLink, parseMobilePairingLink, type MobileLinkPayload } from "./mobile-link.ts";
import { phonePairingLink } from "./pairing-link.ts";

const token = `omb_pair_${"a".repeat(43)}`;
const payload: MobileLinkPayload = {
  v: MOBILE_LINK_VERSION,
  workspace: { name: "My VPS", environmentId: "env_1", kind: "vps" },
  grant: { id: "g1", secret: "s3cret", expiresAt: 1_900_000_000_000 },
  via: [
    { kind: "https", url: "https://vps.example.com" },
    { kind: "relay", base: "https://link.dusk.bot", channel: "abcdefghij", token: "tok_1", key: "k".repeat(43) },
  ],
};

describe("mobile pairing link adapter", () => {
  it("reads a v2 link into the phone's view", () => {
    expect(parseMobilePairingLink(mobileLinkUrl(payload))).toMatchObject({
      v: 2, transport: "https", origin: "https://vps.example.com", credential: "s3cret", name: "My VPS", environmentId: "env_1",
      relay: { base: "https://link.dusk.bot", channel: "abcdefghij", token: "tok_1" }, grantId: "g1", workspaceKind: "vps",
    });
  });

  it("reads a relay-only v2 link", () => {
    const link = mobileLinkUrl({ ...payload, via: [payload.via[1]!] });
    expect(parseMobilePairingLink(link)).toMatchObject({ transport: "relay", relay: { channel: "abcdefghij" } });
    expect(parseMobilePairingLink(link)?.origin).toBeUndefined();
  });

  it("still reads an older server or companion link", () => {
    expect(parseMobilePairingLink(phonePairingLink({ address: "https://vps.example.com", token, name: "Old" })!)).toMatchObject({ v: 1, transport: "https", origin: "https://vps.example.com", credential: token });
    expect(parseMobilePairingLink(phonePairingLink({ address: "192.168.1.4", port: 8810, token, code: "123456" })!)).toMatchObject({ transport: "companion", origin: "http://192.168.1.4:8810", code: "123456" });
  });

  it("refuses malformed links", () => {
    expect(parseMobilePairingLink("duskbot://pair?token=short&address=https://a.b")).toBeNull();
    expect(parseMobilePairingLink(`duskbot://pair?token=${token}`)).toBeNull();
    expect(parseMobilePairingLink("duskbot://pair?m=notjson")).toBeNull();
  });

  it("reads a universal link as the app link it stands for", () => {
    const open = mobileOpenLink({ botId: "nova", threadId: "t-1" });
    expect(appLinkFromUniversal(`https://dusk.bot/m/open?${open.split("?")[1]}`)).toBe(open);
    expect(appLinkFromUniversal(`https://dusk.bot/m/open#${open.split("?")[1]}`)).toBe(open);
    const pair = mobileLinkUrl(payload);
    expect(parseMobilePairingLink(appLinkFromUniversal(`https://dusk.bot/m/pair#${pair.split("?")[1]}`)!)).toMatchObject({ v: 2, credential: "s3cret" });
  });

  it("a pairing secret is only taken from the part of a universal link no web server sees", () => {
    const pair = mobileLinkUrl(payload);
    expect(appLinkFromUniversal(`https://dusk.bot/m/pair?${pair.split("?")[1]}`)).toBeNull();
  });

  it("leaves every other address alone", () => {
    for (const link of ["https://dusk.bot/", "https://dusk.bot/pricing", "https://dusk.bot/m/buy?x=1", "https://evil.example/m/open?bot=a", "http://dusk.bot/m/open?bot=a", "https://user@dusk.bot/m/open?bot=a", "duskbot://open?bot=a", "not a link"]) {
      expect(appLinkFromUniversal(link)).toBeNull();
    }
  });

  it("round-trips an open link", () => {
    const target = { environmentId: "env_1", botId: "nova", threadId: "t-1", view: "computer" as const };
    expect(parseMobileOpenLink(mobileOpenLink(target))).toEqual(target);
    expect(parseMobileOpenLink("duskbot://open?view=nope&bot=a b")).toEqual({});
  });
});
