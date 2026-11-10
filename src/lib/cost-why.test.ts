import { describe, expect, it } from "vitest";

import { costWhy, kindOf, receiptLine } from "./cost-why";

const tools = (...list: Array<[string, number]>) => list.map(([name, count]) => ({ name, count, failed: 0 }));
const usd = (value: number) => `$${value.toFixed(2)}`;

describe("a receipt's one-line why", () => {
  it("names what most of the steps went on, in plain words", () => {
    expect(costWhy({ tools: tools(["mcp__composio__GMAIL_FETCH_EMAILS", 42], ["Read", 3]) })).toBe("mostly reading 42 emails");
    expect(costWhy({ tools: tools(["WebSearch", 2], ["WebFetch", 5]) })).toBe("mostly reading 5 web pages");
    expect(costWhy({ tools: tools(["Bash", 1]) })).toBe("mostly running a command");
    expect(costWhy({ tools: [] })).toBe("mostly writing the reply");
  });

  it("groups tools of one kind", () => {
    expect(costWhy({ tools: tools(["Read", 2], ["Grep", 2], ["Bash", 3]) })).toBe("mostly reading 4 files");
    expect(kindOf("googlecalendar_list_events")).toBe("calendar");
    expect(kindOf("something_else")).toBe("steps");
  });

  it("puts the cost first, and says nothing for a turn with no price", () => {
    expect(receiptLine({ tools: tools(["Bash", 3]), usage: { input: 1, output: 1, costUsd: 0.18 } }, usd)).toBe("$0.18 · mostly running 3 commands");
    expect(receiptLine({ tools: tools(["Bash", 3]), usage: { input: 1, output: 1, costUsd: null } }, usd)).toBeNull();
    expect(receiptLine({ tools: [] }, usd)).toBeNull();
  });
});
