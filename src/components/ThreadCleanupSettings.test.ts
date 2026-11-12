import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ThreadCleanupSettings, parseCapMib } from "./ThreadCleanupSettings";

const fixture = vi.hoisted(() => ({
  threads: undefined as { maxConcurrentPerBot: number; eventLogMaxBytes?: number; eventLogRetentionDays?: number } | undefined,
}));
vi.mock("@/state/store", () => ({
  api: vi.fn(),
  useStore: () => ({ state: { config: fixture.threads === undefined ? {} : { threads: fixture.threads } }, dispatch: vi.fn() }),
}));

describe("ThreadCleanupSettings", () => {
  it("rejects cap values that are not exact 0.25 MiB steps", () => {
    expect(parseCapMib("0.25")).toBe(256 * 1024);
    expect(parseCapMib("1.5")).toBe(1536 * 1024);
    expect(parseCapMib("50")).toBe(50 * 1024 * 1024);
    expect(parseCapMib("0.251")).toBeNull();
    expect(parseCapMib("0.3")).toBeNull();
  });

  it("keeps both knobs off by default, each a row with its switch", () => {
    fixture.threads = undefined;
    const markup = renderToStaticMarkup(createElement(ThreadCleanupSettings));
    expect(markup).toContain('id="thread-log-retention-enabled"');
    expect(markup).toContain('id="thread-log-cap-enabled"');
    expect(markup.match(/role="switch"[^>]*aria-checked="false"/g)).toHaveLength(2);
    expect(markup.match(/>off</g)).toHaveLength(2);
    // the number fields live in each knob's own dialog
    expect(markup).not.toContain("<input");
  });

  it("shows the confirmed server values, cap converted from bytes to MiB", () => {
    fixture.threads = { maxConcurrentPerBot: 3, eventLogRetentionDays: 14, eventLogMaxBytes: 52428800 };
    const markup = renderToStaticMarkup(createElement(ThreadCleanupSettings));
    expect(markup.match(/role="switch"[^>]*aria-checked="true"/g)).toHaveLength(2);
    expect(markup).toContain("after 14 days");
    expect(markup).toContain("up to 50 MiB");
  });

  it("renders a sub-megabyte cap as a fractional MiB value", () => {
    fixture.threads = { maxConcurrentPerBot: 3, eventLogMaxBytes: 262144 };
    const markup = renderToStaticMarkup(createElement(ThreadCleanupSettings));
    expect(markup).toContain("up to 0.25 MiB");
  });

  it("keeps no help paragraphs", () => {
    fixture.threads = { maxConcurrentPerBot: 3, eventLogRetentionDays: 7, eventLogMaxBytes: 1048576 };
    const markup = renderToStaticMarkup(createElement(ThreadCleanupSettings));
    expect(markup).not.toContain("thread-log-retention-help");
    expect(markup).not.toContain("<p");
  });
});
