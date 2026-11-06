import assert from "node:assert/strict";
import { test } from "node:test";
import { commandPath, probeShellPath } from "./shell-path.mjs";

test("the shell PATH comes first, then the app's own and the usual install folders, each once", async () => {
  const merged = await commandPath({ platform: "darwin", env: { PATH: "/usr/bin:/bin" }, home: "/nowhere", probe: async () => "/opt/fixture/bin:/usr/bin", exists: dir => dir === "/opt/homebrew/bin" });
  assert.equal(merged, "/opt/fixture/bin:/usr/bin:/bin:/opt/homebrew/bin");
  const unread = await commandPath({ platform: "darwin", env: { PATH: "/usr/bin:/bin" }, home: "/nowhere", probe: async () => null, exists: () => true });
  assert.equal(unread, "/usr/bin:/bin:/opt/homebrew/bin:/usr/local/bin:/nowhere/.local/bin");
  assert.equal(await commandPath({ platform: "win32", env: { PATH: "C:\\Windows" }, probe: async () => assert.fail("never probed on Windows") }), "C:\\Windows");
});

test("a login shell that fails, prints nothing or hangs gives no PATH", { skip: process.platform === "win32" }, async () => {
  assert.equal(await probeShellPath({ shell: "/nonexistent/shell" }), null);
  assert.equal(await probeShellPath({ shell: "/usr/bin/true" }), null);
});
