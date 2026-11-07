import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { MacJobs } from "./jobs.ts";

const request = (jobs: MacJobs, active = () => true) =>
  jobs.request({ tool: "mac_exec", args: { command: "ls" }, bot: { id: "nova", name: "Nova" }, timeoutMs: 60_000, active, offlineText: "offline" });

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

it("a job nobody takes is offline, one waiting behind a busy Mac says busy, and an ended turn's job is never handed out", async () => {
  const jobs = new MacJobs();
  const lonely = request(jobs);
  await vi.advanceTimersByTimeAsync(3_000);
  expect(await lonely).toMatchObject({ ok: false, code: "offline", error: "offline" });

  const taken = request(jobs);
  const delivered = await jobs.poll();
  expect(delivered).toMatchObject({ tool: "mac_exec", bot: { name: "Nova" } });
  await vi.advanceTimersByTimeAsync(30_000);
  expect(jobs.online()).toBe(true);
  const waiting = request(jobs);
  await vi.advanceTimersByTimeAsync(10_000);
  expect(await waiting).toMatchObject({ ok: false, error: expect.stringContaining("busy") });
  expect(jobs.complete(delivered!.id, { ok: true, result: { text: "done" } })).toBe(true);
  expect(await taken).toEqual({ ok: true, result: { text: "done" } });
  expect(jobs.complete(delivered!.id, { ok: true, result: { text: "again" } })).toBe(false);

  let live = true;
  const ended = request(jobs, () => live);
  live = false;
  const next = jobs.poll(undefined, 1_000);
  await vi.advanceTimersByTimeAsync(1_000);
  expect(await next).toBeNull();
  expect(await ended).toMatchObject({ ok: false, code: "turn_ended" });
  jobs.close();
});
