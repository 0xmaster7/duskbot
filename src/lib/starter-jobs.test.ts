import { describe, expect, it } from "vitest";
import { setLocale, t } from "@/lib/i18n";
import { aiLine, canStart, firstJobOutbound, jobDraft, STARTER_JOBS } from "./starter-jobs";

setLocale("en");

describe("starter jobs", () => {
  it("are the four first asks, each a whole sentence with its example selected for typing over", () => {
    expect(STARTER_JOBS.map((job) => t(job.label))).toEqual(["summarize my inbox", "watch a price", "plan a trip", "research a topic"]);
    const price = jobDraft(STARTER_JOBS[1]!, t);
    expect(price.text).toBe("find the best price for AirPods Pro at a few big shops right now, and offer to keep watching it for drops.");
    expect(price.text.slice(...price.select)).toBe("AirPods Pro");
    const inbox = jobDraft(STARTER_JOBS[0]!, t);
    expect(inbox.select, "a job with nothing to fill in puts the caret at the end").toEqual([inbox.text.length, inbox.text.length]);
  });

  it("selects the example wherever a language puts it", () => {
    const fake = (key: string, values?: Record<string, string>) => key.endsWith(".example") ? "Lisboa" : `Viaje a ${values?.thing} de tres días`;
    const draft = jobDraft(STARTER_JOBS[2]!, fake as typeof t);
    expect(draft.text.slice(...draft.select)).toBe("Lisboa");
  });
});

describe("the AI line", () => {
  it("uses a found sign-in once it answers, and while it is being checked", () => {
    expect(aiLine({ state: "passed" }, false)).toBe("ready");
    expect(aiLine({ state: "untestable" }, false)).toBe("ready");
    expect(aiLine({ state: "testing" }, false)).toBe("checking");
  });

  it("falls back to the free model so nothing blocks, and asks for a sign-in only when nothing can run", () => {
    expect(aiLine(null, true)).toBe("free");
    expect(aiLine({ state: "failed" }, true)).toBe("free");
    expect(aiLine(null, false)).toBe("connect");
    expect(aiLine({ state: "failed" }, false)).toBe("connect");
  });

  it("lets a job start on any AI that can run it, never on an empty ask", () => {
    for (const line of ["ready", "checking", "free"] as const) expect(canStart(line, "plan a trip")).toBe(true);
    expect(canStart("connect", "plan a trip")).toBe(false);
    expect(canStart("ready", "   ")).toBe(false);
  });
});

describe("the first job's permissions", () => {
  it("make sends, posts and payments wait for a tap, and keep a rule the person already chose", () => {
    expect(firstJobOutbound(undefined)).toEqual({ outbound: { policy: "ask", dailyCap: 25 } });
    expect(firstJobOutbound({ policy: "allow", dailyCap: 5 })).toEqual({});
  });
});
