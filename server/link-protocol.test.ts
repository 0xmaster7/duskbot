import { describe, expect, it } from "vitest";

// @ts-expect-error the link agent is a standalone script without type declarations
import { LINK_MIN_SERVER, LINK_PROTOCOL } from "../apps/link-service/agent.mjs";
import { MIN_AGENT_LINK_PROTOCOL, SERVER_LINK_PROTOCOL, linkProtocolInfo } from "./link-protocol.ts";

describe("the server's link protocol", () => {
  it("is what the descriptor says, and works with the agent shipped beside it", () => {
    expect(linkProtocolInfo()).toEqual({ protocol: SERVER_LINK_PROTOCOL, minAgent: MIN_AGENT_LINK_PROTOCOL });
    expect(LINK_PROTOCOL).toBeGreaterThanOrEqual(MIN_AGENT_LINK_PROTOCOL);
    expect(SERVER_LINK_PROTOCOL).toBeGreaterThanOrEqual(LINK_MIN_SERVER);
  });
});
