import { expect, it } from "vitest";
import { homeFixture } from "./test-fixture.ts";

it("backs up a running home at once when its owner's move into it was checked, at most once per ten minutes", async () => {
  const f = await homeFixture();
  const { c } = await f.paid();
  const managed = f.service.managed!;
  f.advance(11 * 60_000);
  const before = f.backups.list(c.id).length;
  expect(await managed.backupNow!(c)).toBe(true);
  expect(f.backups.list(c.id)).toHaveLength(before + 1);
  expect(f.audit.entries(c.id).some((entry: { action?: string; reason?: string }) => entry.action === "backup" && entry.reason === "after_move")).toBe(true);
  expect(await managed.backupNow!(c), "asked again at once: the last try is too recent").toBe(false);
  expect(f.backups.list(c.id)).toHaveLength(before + 1);
  f.advance(11 * 60_000);
  expect(await managed.backupNow!(c)).toBe(true);
});
