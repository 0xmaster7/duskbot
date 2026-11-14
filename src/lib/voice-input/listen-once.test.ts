import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createVoiceEvents, type VoiceBridge } from "./bridge";
import { listenOnce } from "./listen-once";

function fakeBridge(overrides: Partial<VoiceBridge> = {}) {
  const events = createVoiceEvents();
  const bridge = {
    speechStart: vi.fn(async () => {}),
    speechStop: vi.fn(async () => {}),
    speechFinish: vi.fn(async () => {}),
    onSpeechTranscript: vi.fn(events.onSpeechTranscript),
    onSpeechEnd: vi.fn(events.onSpeechEnd),
    ...overrides,
  };
  return { bridge, events };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("listening once for the Settings test", () => {
  it("records for the given time, finishes, and resolves with the final words", async () => {
    const { bridge, events } = fakeBridge();
    const result = listenOnce(bridge, { ms: 3_000, locale: "en-GB" });
    await vi.advanceTimersByTimeAsync(0);
    expect(bridge.speechStart).toHaveBeenCalledWith({ locale: "en-GB" });
    events.transcript({ partial: true, text: "hello" });
    await vi.advanceTimersByTimeAsync(2_999);
    expect(bridge.speechFinish).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(bridge.speechFinish).toHaveBeenCalledTimes(1);
    events.transcript({ partial: false, text: "Hello there." });
    await expect(result).resolves.toEqual({ ok: true, text: "Hello there." });
    // the listeners are gone: a late line changes nothing and throws nothing
    events.transcript({ partial: false, text: "late" });
  });

  it("resolves with what was heard when the engine ends after finishing", async () => {
    const { bridge, events } = fakeBridge();
    const result = listenOnce(bridge, { ms: 100 });
    await vi.advanceTimersByTimeAsync(0);
    events.transcript({ partial: true, text: "testing one two" });
    await vi.advanceTimersByTimeAsync(100);
    events.end({ code: 0, reason: "completed" });
    await expect(result).resolves.toEqual({ ok: true, text: "testing one two" });
    expect(bridge.speechStop).not.toHaveBeenCalled();
  });

  it("says nothing was heard when the session ends empty", async () => {
    const { bridge, events } = fakeBridge();
    const result = listenOnce(bridge, { ms: 100 });
    await vi.advanceTimersByTimeAsync(100);
    events.end({ code: 0 });
    await expect(result).resolves.toEqual({ ok: false, end: { code: 1, reason: "no-words" } });
  });

  it("passes the engine's own failure on, so Settings can word it", async () => {
    const { bridge, events } = fakeBridge();
    const result = listenOnce(bridge, { ms: 3_000 });
    await vi.advanceTimersByTimeAsync(0);
    events.end({ code: 1, reason: "microphone-blocked" });
    await expect(result).resolves.toEqual({ ok: false, end: { code: 1, reason: "microphone-blocked" } });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(bridge.speechFinish).not.toHaveBeenCalled();
  });

  it("stops the bridge and fails plainly when starting throws", async () => {
    const { bridge } = fakeBridge({ speechStart: vi.fn(async () => { throw new Error("no key"); }) });
    await expect(listenOnce(bridge)).resolves.toEqual({ ok: false, end: { code: 1, reason: "recognition-error", message: "no key" } });
    expect(bridge.speechStop).toHaveBeenCalledTimes(1);
  });

  it("gives up after the grace period and always stops the session", async () => {
    const { bridge } = fakeBridge();
    const result = listenOnce(bridge, { ms: 100, graceMs: 1_000 });
    await vi.advanceTimersByTimeAsync(1_100);
    await expect(result).resolves.toEqual({ ok: false, end: { code: 1, reason: "transcribe-timeout" } });
    expect(bridge.speechStop).toHaveBeenCalledTimes(1);
  });

  it("stops when the person leaves before it finishes", async () => {
    const { bridge } = fakeBridge();
    const controller = new AbortController();
    const result = listenOnce(bridge, { signal: controller.signal });
    await vi.advanceTimersByTimeAsync(10);
    controller.abort();
    await expect(result).resolves.toEqual({ ok: false, end: { code: 1, reason: "aborted" } });
    expect(bridge.speechStop).toHaveBeenCalledTimes(1);
  });

  it("stops an engine that cannot finish and keeps what it heard", async () => {
    const { bridge, events } = fakeBridge({ speechFinish: undefined });
    const result = listenOnce(bridge, { ms: 100 });
    await vi.advanceTimersByTimeAsync(0);
    events.transcript({ partial: true, text: "words" });
    await vi.advanceTimersByTimeAsync(100);
    await expect(result).resolves.toEqual({ ok: true, text: "words" });
    expect(bridge.speechStop).toHaveBeenCalledTimes(1);
  });
});
