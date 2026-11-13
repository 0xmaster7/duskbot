import { describe, expect, it } from "vitest";

import { NOISY_MEMORIES } from "../server/testing/agent-app-fixtures.ts";
import { DISTILL_CHUNK_CHARS, DISTILL_MAX_CHARS, distillChunks, distillLines, NOTE_MAX_CHARS, nearDuplicate, noiseReason } from "./memory-distill.ts";
import { redactSecretsInText } from "./redact.ts";

const NOW = Date.UTC(2026, 10, 13);

describe("the rules pass over another app's memory", () => {
  it("keeps durable facts once and leaves out chatter, tool output, old one-offs, repeats, near-repeats and keys", () => {
    const lines = NOISY_MEMORIES.map((line) => redactSecretsInText(line));
    const out = distillLines(lines, { cap: 40, now: NOW });
    expect(out.keep).toEqual([
      "Priya runs a two-person design studio in Pune.",
      "Prefers replies under five lines, no emoji.",
      "Her sister Meera is moving to Lisbon in March.",
      "Client: Hartwell Coffee, rebrand due before their spring launch.",
    ]);
    expect(out.later, "a passage goes to the engine, never kept as it is").toHaveLength(1);
    expect(out.later[0]!.length).toBeGreaterThan(NOTE_MAX_CHARS);
    expect(out.dropped).toBe(NOISY_MEMORIES.length - 5);
  });

  it("says why a line is noise", () => {
    expect(noiseReason("ok")).toBe("empty");
    expect(noiseReason("thanks!")).toBe("chatter");
    expect(noiseReason("Error: something broke at line 4")).toBe("output");
    expect(noiseReason("password: hunter2-hunter2")).toBe("secret");
    expect(noiseReason("_(optional)_")).toBe("placeholder");
    expect(noiseReason("2025-01-10 meeting with the bank", NOW)).toBe("stale");
    expect(noiseReason("2026-11-01 meeting with the bank", NOW), "a recent one-off may still matter").toBeNull();
    expect(noiseReason("Works nights; never message before noon.")).toBeNull();
  });

  it("keeps the cap, sending the rest to the engine, and never keeps a fact twice across lists", () => {
    const word = (i: number) => `w${i.toString(36)}x${(i * 7).toString(36)}`;
    const many = Array.from({ length: 50 }, (_, i) => `Fact ${word(i)} ${word(i + 100)} ${word(i + 200)} ${word(i + 300)}`);
    const seen: string[] = [];
    const first = distillLines(many, { cap: 40, seen });
    expect(first.keep).toHaveLength(40);
    expect(first.later).toHaveLength(10);
    expect(distillLines([many[0]!, "Something else entirely new here"], { cap: 40, seen }).keep).toEqual(["Something else entirely new here"]);
    expect(nearDuplicate("Prefers replies under five lines, no emoji.", "prefers replies under five lines and no emoji")).toBe(true);
    expect(nearDuplicate("Sister lives in Lisbon", "Brother lives in Porto")).toBe(false);
  });

  it("chunks passages for the engine within its size, without the noise lines", () => {
    const daily = Array.from({ length: 400 }, (_, i) => (i % 3 ? `- Decided the studio ${i} keeps Fridays for deep work` : "- ok")).join("\n");
    const chunks = distillChunks([`# Daily notes\n${daily}`]);
    expect(chunks.every((chunk) => chunk.length <= DISTILL_CHUNK_CHARS)).toBe(true);
    expect(chunks.join("\n").length).toBeLessThanOrEqual(DISTILL_MAX_CHARS + chunks.length);
    expect(chunks.join("\n")).not.toMatch(/^- ok$/m);
    expect(distillChunks(["# Only a heading\n- ok\n- done"])).toEqual([]);
  });
});
