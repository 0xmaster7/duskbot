import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { afterEach, expect, it, vi } from "vitest";
import { APP_REPOSITORY, RELEASES_URL } from "../src/lib/app-links.ts";
import { DESKTOP_UPDATES_ENABLED } from "./update-policy.mjs";

const fixture = vi.hoisted(() => ({
  vendor: vi.fn(() => { throw new Error("an update provider must not load"); }),
  getPath: vi.fn(() => { throw new Error("update records must not be read"); }),
  getVersion: vi.fn(() => "0.1.141"),
  hide: vi.fn(), handlers: new Map(),
}));

vi.mock("electron", () => ({
  app: { isPackaged: true, getPath: fixture.getPath, getVersion: fixture.getVersion, hide: fixture.hide },
  clipboard: { writeText: vi.fn() }, ipcMain: { handle: (channel, handler) => fixture.handlers.set(channel, handler) },
}));
vi.mock("node:module", () => ({ createRequire: () => fixture.vendor }));

afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.clearAllMocks(); });

it("never loads a provider, stages a native Mac feed, or installs a cached update in the packaged fork", async () => {
  vi.useFakeTimers();
  expect(DESKTOP_UPDATES_ENABLED).toBe(false);
  const updater = await import("./updater.mjs");
  updater.registerUpdaterIpc({ pageAllowed: () => true });
  const signals = { watch: vi.fn() };
  updater.startUpdater(signals);
  expect(updater.reopenedOutOfSight()).toBe(false);
  await fixture.handlers.get("update:check")({});
  await fixture.handlers.get("update:install")({});
  await vi.advanceTimersByTimeAsync(2 * 60 * 60_000);
  expect(fixture.handlers.get("update:get-state")({})).toEqual({ status: "idle" });
  expect(fixture.vendor).not.toHaveBeenCalled();
  expect(fixture.getPath).not.toHaveBeenCalled();
  expect(fixture.hide).not.toHaveBeenCalled();
  expect(signals.watch).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it("ships no publish feed and points release links and package metadata only at the private fork", () => {
  const config = parse(readFileSync(new URL("../electron-builder.yml", import.meta.url), "utf8"));
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  expect(config.publish).toBeNull();
  expect(APP_REPOSITORY).toBe("https://github.com/SiddDevZ/OpenMausBot");
  expect(RELEASES_URL).toBe(`${APP_REPOSITORY}/releases`);
  expect(pkg.private).toBe(true);
  expect(pkg.repository.url).toBe(`${APP_REPOSITORY}.git`);
  expect(pkg.homepage).toBe(APP_REPOSITORY);
  expect(pkg.author.name).toBe("Milind Soni");
  expect(pkg.license).toBe("SEE LICENSE IN LICENSE");
});
