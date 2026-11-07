import { describe, expect, it } from "vitest";
import { mobileOpenLink, parseMobileOpenLink, parseMobilePairingLink } from "./mobile-link.ts";
import { phonePairingLink } from "./pairing-link.ts";

const token = `omb_pair_${"a".repeat(43)}`;

describe("mobile link", () => {
  it("reads a server pairing link as an https workspace", () => {
    const link = phonePairingLink({ address: "https://vps.example.com", token, name: "My VPS" })!;
    expect(parseMobilePairingLink(`${link}&env=env_1`)).toEqual({ v: 1, transport: "https", origin: "https://vps.example.com", credential: token, name: "My VPS", environmentId: "env_1" });
  });

  it("reads a companion link with its six digits", () => {
    const link = phonePairingLink({ address: "192.168.1.4", port: 8810, token, code: "123456" })!;
    expect(parseMobilePairingLink(link)).toMatchObject({ transport: "companion", origin: "http://192.168.1.4:8810", code: "123456" });
  });

  it("reads a relay-only link", () => {
    const link = `openmausbot://pair?token=${token}&relay=${encodeURIComponent("https://link.apps.siddz.com")}&channel=ch_12345678`;
    expect(parseMobilePairingLink(link)).toMatchObject({ transport: "relay", relay: { service: "https://link.apps.siddz.com", channel: "ch_12345678" } });
  });

  it("refuses malformed links", () => {
    expect(parseMobilePairingLink("openmausbot://pair?token=short&address=https://a.b")).toBeNull();
    expect(parseMobilePairingLink(`openmausbot://pair?token=${token}`)).toBeNull();
    expect(parseMobilePairingLink(`https://x/pair?token=${token}&address=https://a.b`)).toBeNull();
    expect(parseMobilePairingLink(`openmausbot://pair?token=${token}&address=${encodeURIComponent("https://u:p@a.b")}`)).toBeNull();
  });

  it("round-trips an open link", () => {
    const target = { environmentId: "env_1", botId: "nova", threadId: "t-1", view: "computer" as const };
    expect(parseMobileOpenLink(mobileOpenLink(target))).toEqual(target);
    expect(parseMobileOpenLink("openmausbot://open?view=nope&bot=a b")).toEqual({});
  });
});
