import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { directoryKey } from "../../../shared/connector-directory";
import { REMOTE_MCP_APPS } from "../../../server/connectors/remote-mcp.ts";
import type { AppEntry } from "./catalog";
import { DISTINCT, idsOf, matchKeys, mergeEntries } from "./merge";

const entry = (id: string, kind: AppEntry["kind"], label: string, patch: Partial<AppEntry> = {}): AppEntry =>
  ({ id, kind, label, description: `${label} from ${kind}`, categories: ["other"], icon: {}, ...patch });

// our own cards, as nativeEntries() lists them
const OWN: AppEntry[] = [
  entry("1password", "logins", "1Password", { categories: ["credentials"], website: "1password.com", icon: { image: "1password.svg" } }),
  entry("email", "native", "Email"),
  entry("x", "native", "X", { website: "x.com" }),
  entry("highlevel", "native", "HighLevel", { website: "gohighlevel.com" }),
  entry("custom-mcp", "native", "Custom MCP"),
  entry("postiz", "native", "Postiz", { website: "postiz.com" }),
  entry("whop", "hosted", "Whop", { website: "whop.com" }),
  entry("agentcard", "hosted", "Agentcard", { website: "agentcard.sh" }),
];

describe("one row per app across our cards, Composio and the vendors' own servers", () => {
  it("folds our 1Password and Composio's into our row, keeping our name and logo, with Composio as its second way", () => {
    const rows = mergeEntries([...OWN.slice(0, 1), entry("asana", "composio", "Asana"), entry("_1password", "composio", "1password")]);
    expect(rows.map((row) => row.id)).toEqual(["1password", "asana"]);
    expect(rows[0]).toMatchObject({ kind: "logins", label: "1Password", description: "1Password from logins", icon: { image: "1password.svg" }, composio: "_1password" });
    expect(idsOf(rows[0]!)).toEqual(["1password", "_1password"]);
  });

  it("keeps a vendor's server and Composio's listing as one Composio row named as our table names it, its MCP flavour folded in", () => {
    const rows = mergeEntries([
      entry("github_mcp", "composio", "GitHub MCP"), entry("cal", "composio", "Cal"), entry("github", "composio", "GitHub"),
      entry("cal", "remote", "Cal.com", { website: "cal.com" }), entry("huggingface", "remote", "Hugging Face"), entry("hugging_face", "composio", "Hugging Face"),
    ]);
    expect(rows.map((row) => [row.id, row.kind, row.label, row.remote, row.aliases])).toEqual([
      ["github", "composio", "GitHub", undefined, ["github_mcp"]],
      ["cal", "composio", "Cal.com", "cal", undefined],
      ["hugging_face", "composio", "Hugging Face", "huggingface", undefined],
    ]);
  });

  it("matches known pairs that share nothing but the app, and keeps look-alikes apart", () => {
    const rows = mergeEntries([OWN[2]!, entry("twitter", "composio", "Twitter"), entry("gender_api", "composio", "Gender API"), entry("genderapi_io", "composio", "GenderAPI.io")]);
    expect(rows.map((row) => row.id)).toEqual(["x", "gender_api", "genderapi_io"]);
    expect(rows[0]!.composio).toBe("twitter");
  });

  it("never folds a person's own MCP server into an app", () => {
    expect(mergeEntries([entry("notion", "composio", "Notion"), entry("mcp:notion", "custom", "notion")])).toHaveLength(2);
  });

  it("leaves no app listed twice in the whole catalog", () => {
    const bundled = JSON.parse(readFileSync(new URL("../../data/composio/toolkits.json", import.meta.url), "utf8")) as { toolkits: Array<{ slug: string; name: string }> };
    const composio = bundled.toolkits.map((toolkit) => entry(toolkit.slug, "composio", toolkit.name));
    const remote = REMOTE_MCP_APPS.map((app) => entry(app.id, "remote", app.label, { website: app.domain ?? undefined }));
    // before: the window hid a vendor's server behind Composio's row of the same key, and nothing else
    const taken = new Set([...OWN, ...composio].flatMap((row) => [directoryKey(row.id), directoryKey(row.label)]));
    const before = OWN.length + composio.length + remote.filter((app) => ![app.id, app.label].some((name) => taken.has(directoryKey(name)))).length;
    const rows = mergeEntries([...OWN, ...composio, ...remote]);
    const owners = new Map<string, string[]>();
    for (const row of rows) for (const key of matchKeys(row)) owners.set(key, [...(owners.get(key) ?? []), row.id]);
    const allowed = new Set(DISTINCT.map((pair) => [...pair].sort().join()));
    const twice = [...owners.values()].filter((ids) => ids.length > 1 && !allowed.has([...ids].sort().join()));
    console.info(`connect apps rows: ${before} before, ${rows.length} after (${before - rows.length} duplicates folded)`);
    expect(twice).toEqual([]);
    expect(before - rows.length).toBeGreaterThan(70);
    expect(rows.find((row) => row.id === "1password")?.composio).toBe("_1password");
    expect(rows.find((row) => row.id === "postiz")?.composio).toBe("postiz_mcp");
    expect(rows.find((row) => row.id === "notion")).toMatchObject({ kind: "composio", remote: "notion", aliases: ["notion_mcp"] });
  });
});
