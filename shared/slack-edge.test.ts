import { expect, it } from "vitest";
import { edgeEventKind, openSealed, sealForDesktop, slackEdgeKeys, validEdgePublicKey } from "./slack-edge.ts";

it("seals to the desktop's key so only that key opens it, bound to its bot", () => {
  const desktop = slackEdgeKeys(), other = slackEdgeKeys();
  expect(validEdgePublicKey(desktop.publicKey)).toBe(true);
  const sealed = sealForDesktop(desktop.publicKey, "bot_a", JSON.stringify({ text: "hello there" }));
  expect(sealed).not.toContain("hello");
  expect(JSON.parse(openSealed(desktop.privateKey, "bot_a", sealed))).toEqual({ text: "hello there" });
  expect(() => openSealed(other.privateKey, "bot_a", sealed)).toThrow();
  expect(() => openSealed(desktop.privateKey, "bot_b", sealed)).toThrow();
});

it("wakes for DMs and mentions, keeps reactions, drops chatter and the bot's own events, from type fields alone", () => {
  const event = (fields: Record<string, unknown>) => ({ type: "event_callback", event: fields });
  expect(edgeEventKind(event({ type: "app_mention", user: "U1" }), "UBOT")).toBe("wake");
  expect(edgeEventKind(event({ type: "message", channel_type: "im", user: "U1" }), "UBOT")).toBe("wake");
  expect(edgeEventKind(event({ type: "message", channel_type: "im", user: "U1", subtype: "file_share" }), "UBOT")).toBe("wake");
  expect(edgeEventKind(event({ type: "message", channel_type: "im", user: "U1", subtype: "message_changed" }), "UBOT")).toBe("drop");
  expect(edgeEventKind(event({ type: "message", channel_type: "channel", user: "U1" }), "UBOT")).toBe("drop");
  expect(edgeEventKind(event({ type: "message", channel_type: "im", user: "UBOT" }), "UBOT")).toBe("drop");
  expect(edgeEventKind(event({ type: "message", channel_type: "im", bot_id: "B1" }), "UBOT")).toBe("drop");
  expect(edgeEventKind(event({ type: "reaction_added", user: "U1" }), "UBOT")).toBe("keep");
  expect(edgeEventKind({ type: "url_verification" }, "UBOT")).toBe("drop");
});
