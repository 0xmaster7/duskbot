import { join, sep } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createUpdateChecker, installKind, LATEST_RELEASE_URL, type InstallKind } from "./update-check.ts";

afterEach(() => vi.unstubAllGlobals());

describe("server update check", () => {
  it("tells how this server was installed", () => {
    const none = () => false;
    const root = ["", "srv", "Dusk Bot", "server"].join(sep);
    expect(installKind({ desktopManaged: true, managed: false, serverRoot: root, exists: () => true })).toBe("desktop");
    expect(installKind({ desktopManaged: false, managed: true, serverRoot: root, exists: () => true })).toBe("managed");
    expect(installKind({ desktopManaged: false, managed: false, serverRoot: root, exists: (path) => path === "/.dockerenv" })).toBe("docker");
    expect(installKind({ desktopManaged: false, managed: false, serverRoot: root, exists: (path) => path === "/run/.containerenv" })).toBe("podman");
    expect(installKind({
      desktopManaged: false, managed: false, exists: none,
      serverRoot: ["", "usr", "lib", "node_modules", "duskbot", "dist-server"].join(sep),
    })).toBe("npm");
    expect(installKind({ desktopManaged: false, managed: false, serverRoot: root, exists: (path) => path === join(root, "..", ".git") })).toBe("git");
    expect(installKind({ desktopManaged: false, managed: false, serverRoot: root, exists: none })).toBe("unknown");
  });

  it("identifies only this fork as its release repository", () => {
    expect(LATEST_RELEASE_URL).toBe("https://api.github.com/repos/goatedgrokbotalternative/duskbot/releases/latest");
  });

  it("never checks public feeds or suggests upstream install commands for any fork installation", async () => {
    const fetchRelease = vi.fn(async () => new Response(JSON.stringify({
      tag_name: "v999.0.0", html_url: "https://github.com/goatedgrokbotalternative/duskbot/releases/tag/v999.0.0",
    })));
    vi.stubGlobal("fetch", fetchRelease);
    const installs: InstallKind[] = ["desktop", "managed", "docker", "podman", "npm", "git", "unknown"];
    for (const install of installs) {
      const check = createUpdateChecker({ current: "0.1.141", install });
      expect(await check()).toEqual({ current: "0.1.141", install, available: false });
      expect(await check()).not.toHaveProperty("command");
    }
    expect(fetchRelease).not.toHaveBeenCalled();
  });

  it.each([401, 403, 404])("makes no false offer or network request when private releases would return %i", async (status) => {
    const fetchRelease = vi.fn(async () => new Response("{}", { status }));
    vi.stubGlobal("fetch", fetchRelease);
    const check = createUpdateChecker({ current: "0.1.141", install: "git" });
    expect(await check()).toEqual({ current: "0.1.141", install: "git", available: false });
    expect(fetchRelease).not.toHaveBeenCalled();
  });
});
