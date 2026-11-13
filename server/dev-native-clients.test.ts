import { describe, expect, it } from "vitest";

import { nativeClientsFrom } from "./dev-native-clients.ts";

describe("a source checkout's own OAuth clients", () => {
  const file = [
    "# [account] shared",
    "DUSK_OAUTH_NOTION_CLIENT_ID=notion-id",
    "DUSK_OAUTH_NOTION_CLIENT_SECRET='notion-secret'",
    "DUSK_OAUTH_LINEAR_CLIENT_ID=\"linear-id\"",
    "DUSK_OAUTH_TODOIST_CLIENT_ID=",
    "DUSK_BREVO_API_KEY=not-a-client",
    "MONGODB_URI_PREVIEW=mongodb://x",
  ].join("\n");
  const names = ["DUSK_OAUTH_NOTION_CLIENT_ID", "DUSK_OAUTH_NOTION_CLIENT_SECRET", "DUSK_OAUTH_LINEAR_CLIENT_ID", "DUSK_OAUTH_TODOIST_CLIENT_ID"];

  // regression: the dev server read only its own environment, so every one-click sign-in said it wasn't set up
  it("takes only the client names, unquoted, and skips empty values", () => {
    expect(nativeClientsFrom(file, {}, names)).toEqual({
      DUSK_OAUTH_NOTION_CLIENT_ID: "notion-id",
      DUSK_OAUTH_NOTION_CLIENT_SECRET: "notion-secret",
      DUSK_OAUTH_LINEAR_CLIENT_ID: "linear-id",
    });
  });

  it("never overrides a value the environment already has", () => {
    expect(nativeClientsFrom(file, { DUSK_OAUTH_NOTION_CLIENT_ID: "mine" }, names)).not.toHaveProperty("DUSK_OAUTH_NOTION_CLIENT_ID");
  });

  it("lists every name the release bakes in", async () => {
    const { NATIVE_CLIENT_ENVS } = await import("../shared/native-connectors.ts");
    expect(nativeClientsFrom("DUSK_OAUTH_TRELLO_API_KEY=k", {})).toEqual(NATIVE_CLIENT_ENVS.includes("DUSK_OAUTH_TRELLO_API_KEY") ? { DUSK_OAUTH_TRELLO_API_KEY: "k" } : {});
  });
});
