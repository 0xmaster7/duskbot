import { describe, expect, it } from "vitest";
import { billableFor, priceFor, type PriceList } from "./prices.ts";

describe("prices", () => {
  const prices: PriceList = {
    default: { inputPerMillion: 1, outputPerMillion: 2 },
    "claude-sonnet-5": { inputPerMillion: 3, outputPerMillion: 15, cachedInputPerMillion: 0.3 },
    "codex/gpt-5": { inputPerMillion: 2, outputPerMillion: 8 },
  };

  it("picks driver/model over model over default, and prices cached input apart when asked", () => {
    expect(priceFor({ driverKind: "codex", model: "gpt-5" }, prices)).toEqual({ inputPerMillion: 2, outputPerMillion: 8 });
    expect(priceFor({ driverKind: "claudeAgent", model: "claude-sonnet-5" }, prices)?.inputPerMillion).toBe(3);
    expect(priceFor({ driverKind: "x", model: "unknown" }, prices)?.inputPerMillion).toBe(1);
    expect(priceFor({ driverKind: "x", model: "unknown" }, { "claude-sonnet-5": prices["claude-sonnet-5"]! })).toBeNull();
    // 1M fresh input at 3, 1M cached at 0.3, 100k output at 15
    expect(billableFor({ driverKind: "claudeAgent", model: "claude-sonnet-5", input: 2_000_000, cachedInput: 1_000_000, output: 100_000 }, prices)).toBeCloseTo(3 + 0.3 + 1.5, 9);
    expect(billableFor({ driverKind: "codex", model: "gpt-5", input: 10, cachedInput: 50, output: 0 }, prices)).toBeCloseTo(10 * 2 / 1_000_000, 12);
    expect(billableFor({ driverKind: "x", model: "y", input: 10, output: 10 }, {})).toBeNull();
  });
});

