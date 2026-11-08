import { describe, expect, it } from "vitest";
import { fromSlackText, splitSlackText, stripBotMention, toSlackMrkdwn } from "./mrkdwn.ts";

describe("toSlackMrkdwn", () => {
  it.each([
    ["# Heading\n## Two", "*Heading*\n*Two*"],
    ["**bold** __bold__ *italic* _italic_ ~~gone~~", "*bold* *bold* _italic_ _italic_ ~gone~"],
    ["[site](https://x?a=1&b=2) [mail](mailto:a@b)", "<https://x?a=1&amp;b=2|site> <mailto:a@b|mail>"],
    ["[local](../file) [bad](javascript:alert)", "local (../file) bad (javascript:alert)"],
    ["![alt](https://x/a.png)", "<https://x/a.png|alt>"],
    ["<https://x?a=1&b=2>", "<https://x?a=1&amp;b=2>"],
    ["- a\n  * b\n\t+ c\n1. d", "• a\n  • b\n\t• c\n1. d"],
    ["> quoted & <tag>", "> quoted &amp; &lt;tag&gt;"],
    ["before\n---\n***\n___\nafter", "before\nafter"],
    ["a & b < c > d", "a &amp; b &lt; c &gt; d"],
    ["`*x* _y_ <z> &` **yes**", "`*x* _y_ <z> &` *yes*"],
    ["```ts\nconst x = '*_&<>';\n```\n**yes**", "```\nconst x = '*_&<>';\n```\n*yes*"],
    ["```\n* _ ** __ & < >\n```", "```\n* _ ** __ & < >\n```"],
    ["| A | B |\n|---|:--:|\n| *a* | <b> |", "```\n| A | B |\n|---|:--:|\n| *a* | <b> |\n```"],
  ])("converts %s", (source, expected) => expect(toSlackMrkdwn(source)).toBe(expected));
});

describe("splitSlackText", () => {
  it("does not return empty chunks", () => {
    expect(splitSlackText("")).toEqual([]);
    expect(splitSlackText("a")).toEqual(["a"]);
  });
  it.each([
    ["aaaa\n\nbbbb cccc dddd", 12, "aaaa\n\n"],
    ["aaaa\nbbbb cccc dddd", 12, "aaaa\n"],
    ["aaaa bbbb cccc dddd", 12, "aaaa bbbb "],
    ["abcdefghijklmnop", 10, "abcdefghij"],
  ])("prefers boundaries in %s", (text, limit, first) => {
    const chunks = splitSlackText(text, limit);
    expect(chunks[0]).toBe(first);
    expect(chunks.join("")).toBe(text);
    expect(chunks.every((chunk) => chunk.length > 0 && chunk.length <= limit)).toBe(true);
  });
  it("repairs fences and counts the repair in the limit", () => {
    const chunks = splitSlackText("```\n" + "abcdefghij ".repeat(30) + "\n```", 40);
    expect(chunks.length).toBeGreaterThan(3);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(40);
      expect(chunk.startsWith("```")).toBe(true);
      expect(chunk.endsWith("```")).toBe(true);
      expect(chunk.match(/```/g)).toHaveLength(2);
    }
  });
  it("keeps fence boundaries intact with long unbroken content", () => {
    for (let size = 9; size < 50; size++) {
      const chunks = splitSlackText("prefix\n```\n" + "x".repeat(100) + "\n```\ntail", size);
      expect(chunks.every((chunk) => chunk.length <= size && chunk.length > 0)).toBe(true);
      expect(chunks.every((chunk) => (chunk.match(/```/g)?.length ?? 0) % 2 === 0)).toBe(true);
    }
  });
  it("repairs an unclosed fence without exceeding the limit", () => {
    const chunks = splitSlackText("```\n" + "x".repeat(100), 20);
    expect(chunks.every((chunk) => chunk.length <= 20 && (chunk.match(/```/g)?.length ?? 0) === 2)).toBe(true);
  });
  it("uses 3900 by default", () => expect(splitSlackText("x".repeat(8000)).map((c) => c.length)).toEqual([3900, 3900, 200]));
});

describe("fromSlackText", () => {
  it.each([
    ["<@U123> <@U456>", "@Alice @U456"],
    ["<#C123|general> <#C456>", "#general #C456"],
    ["<https://x|label> <https://x|https://x> <https://x>", "label (https://x) https://x https://x"],
    ["<mailto:a@b|a@b> <mailto:a@b>", "a@b a@b"],
    ["<!here> <!channel> <!everyone> <!subteam^S1|@team>", "@here @channel @everyone @team"],
    ["&lt;tag&gt; &amp; &amp;lt;", "<tag> & &lt;"],
  ])("reads %s", (text, expected) => expect(fromSlackText(text, (id) => id === "U123" ? "Alice" : undefined)).toBe(expected));
});

it("strips every exact bot mention and trims", () => {
  expect(stripBotMention(" <@BOT> hey <@BOT|bot> <@OTHER> <@BOT2> ", "BOT")).toBe("hey  <@OTHER> <@BOT2>");
  expect(stripBotMention("<@B.T> x <@BOT>", "B.T")).toBe("x <@BOT>");
});
