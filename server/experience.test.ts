import { describe, expect, it } from "vitest";
import { cleanSignal } from "../shared/product-signals.ts";
import { FOLLOW_UP_MS, createConfusionWatch, createExperienceOutbox, downloadFailReason, followUpKind } from "./experience.ts";

describe("experience outbox", () => {
  it("keeps only catalogued words and counts, and nothing while the switch is off", () => {
    let on = true;
    const outbox = createExperienceOutbox({ enabled: () => on, now: () => 1000 });
    expect(outbox.note("turn_failed", { engine: "claude", reason: "rate_limit", from: "app", room: false })).toBe(true);
    expect(outbox.note("turn_failed", { engine: "claude", reason: "the message text" })).toBe(false);
    expect(outbox.note("confused", { kind: "why", after: "reply", text: "why did you do that" })).toBe(false);
    expect(outbox.note("not_a_signal", {})).toBe(false);
    expect(outbox.take()).toEqual([expect.objectContaining({ name: "turn_failed", at: 1000, props: { engine: "claude", reason: "rate_limit", from: "app", room: false } })]);
    expect(outbox.take()).toEqual([]);
    outbox.note("created", { what: "bot" });
    on = false;
    expect(outbox.take()).toEqual([]);
    expect(outbox.note("created", { what: "bot" })).toBe(false);
    on = true;
    expect(outbox.size()).toBe(0);
  });

  it("lets an experience signal ride a workspace report and an app action alike", () => {
    expect(cleanSignal("refused", { by: "request", code: "bot_limit", status: 409 }, "app")).toEqual({ by: "request", code: "bot_limit", status: 409 });
    expect(cleanSignal("refused", { by: "request", code: "bot_limit", status: 409 }, "workspace")).toEqual({ by: "request", code: "bot_limit", status: 409 });
    expect(cleanSignal("crash", { kind: "page", reason: "oom" }, "workspace")).toBeNull();
    expect(cleanSignal("refused", { by: "request", code: "Has Spaces", status: 409 }, "app")).toBeNull();
  });
});

describe("confusion watch", () => {
  it("names follow-ups right after a reply, and nothing otherwise", () => {
    let time = 0;
    const watch = createConfusionWatch({ now: () => time });
    expect(watch.message("t", "book me a table for two tonight")).toBeNull();
    watch.replied("t", false);
    time += 1000;
    expect(watch.message("t", "book me a table for two tonight")).toEqual({ kind: "repeat", after: "reply" });
    watch.replied("t", false);
    expect(watch.message("t", "please book a table for two people tonight")).toEqual({ kind: "rephrase", after: "reply" });
    watch.replied("t", true);
    expect(watch.message("t", "book a table for two tonight please")).toEqual({ kind: "retried", after: "failed" });
    watch.replied("t", false);
    expect(watch.message("t", "what do you mean by that?")).toEqual({ kind: "what_mean", after: "reply" });
    watch.replied("t", false);
    expect(watch.message("t", "how do i turn on the browser")).toEqual({ kind: "how_do_i", after: "reply" });
    watch.replied("t", false);
    expect(watch.message("t", "that's wrong")).toEqual({ kind: "corrective", after: "reply" });
    expect(watch.message("t", "why")).toBeNull();
    watch.replied("t", false);
    time += FOLLOW_UP_MS + 1;
    expect(watch.message("t", "why did it stop")).toBeNull();
  });

  it("reads only the first words of a follow-up", () => {
    expect(followUpKind("Why is it slow?")).toBe("why");
    expect(followUpKind("tell me why")).toBeNull();
    expect(followUpKind("Huh?")).toBe("what_mean");
    expect(followUpKind("where can I change the model")).toBe("how_do_i");
  });
});

describe("download failures", () => {
  it("are put in a few categories", () => {
    expect(downloadFailReason("the agent-browser download failed its SHA-256 check; nothing was installed")).toBe("checksum");
    expect(downloadFailReason("the agent-browser download failed (HTTP 503)")).toBe("http");
    expect(downloadFailReason("fetch failed")).toBe("network");
    expect(downloadFailReason("ENOSPC: no space left on device")).toBe("disk");
    expect(downloadFailReason("agent-browser publishes no build for freebsd-x64.")).toBe("unsupported");
    expect(downloadFailReason("weird")).toBe("other");
  });
});
