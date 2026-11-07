import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { Message } from "@/state/store";
import { DaySeparator } from "./DaySeparator";

const row = (role: Message["role"], botId?: string) => ({ id: role, role, kind: "text", text: "x", at: 0, ...(botId ? { from: { botId, name: botId } } : {}) }) as unknown as Message;
const stamp = (prev?: Message, next?: Message) => renderToStaticMarkup(createElement(DaySeparator, { at: Date.UTC(2026, 10, 7, 12), today: 0, prev, next }));

describe("DaySeparator", () => {
  it("draws grok's 12/16 stamp, 8px over its text", () => {
    const html = stamp(row("user"), row("user"));
    expect(html).toContain("text-[12px] leading-4");
    expect(html).toContain("pt-2");
    expect(html).not.toContain("py-3");
  });

  it("keeps 18px under the text for the same sender and 30px when the conversation changes hands", () => {
    expect(stamp(row("user"), row("user"))).toContain("pb-0.5");
    expect(stamp(undefined, row("bot"))).toContain("pb-0.5");
    expect(stamp(row("user"), row("bot"))).toContain("pb-3.5");
    expect(stamp(row("bot", "a"), row("bot", "b"))).toContain("pb-3.5");
  });
});
