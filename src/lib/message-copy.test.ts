// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { copyMessage, messageClipboard } from "./message-copy";

afterEach(() => vi.unstubAllGlobals());

const REPLY = [
  "## Plan",
  "",
  "Ship **today**, not *tomorrow*. See [the doc](https://example.com/doc) and `npm test`.",
  "",
  "- first",
  "- second",
  "  - nested",
  "",
  "1. one",
  "2. two",
  "",
  "| Name | Score |",
  "| --- | --- |",
  "| Ada | 9 |",
  "",
  "```js",
  "const a = 1;",
  "```",
  "",
  "- [x] done",
  "- [ ] open",
  "",
  "> quoted line",
  "",
  "Energy is $E = mc^2$.",
].join("\n");

describe("copying a message", () => {
  it("plain text carries the words with no markdown symbols", () => {
    const { text } = messageClipboard(REPLY);
    expect(text).toContain("Plan\n\nShip today, not tomorrow. See the doc (https://example.com/doc) and npm test.");
    expect(text).toContain("• first\n• second\n  • nested");
    expect(text).toContain("1. one\n2. two");
    expect(text).toContain("Name\tScore\nAda\t9");
    expect(text).toContain("const a = 1;");
    expect(text).toContain("☑ done\n☐ open");
    expect(text).toContain("quoted line");
    expect(text).toContain("E = mc^2");
    expect(text).not.toMatch(/\*\*|##|```|\| ---|\[x\]|^> /m);
  });

  it("html keeps the structure and drops the app's classes, inputs and styles", () => {
    const { html } = messageClipboard(REPLY);
    expect(html).toContain("<h2>Plan</h2>");
    expect(html).toContain("<strong>today</strong>");
    expect(html).toContain('<a href="https://example.com/doc">the doc</a>');
    expect(html).toMatch(/<table>[\s\S]*<th>Name<\/th>[\s\S]*<td>Ada<\/td>/);
    expect(html).toContain("<pre><code>const a = 1;\n</code></pre>");
    expect(html).toContain("<code>E = mc^2</code>");
    expect(html).not.toMatch(/class=|style=|<input/);
  });

  it("a single line break stays a line break, as the chat shows it", () => {
    expect(messageClipboard("line one\nline two").text).toBe("line one\nline two");
  });

  it("writes text/html beside text/plain in one clipboard item", async () => {
    const written: Array<Record<string, Blob>> = [];
    vi.stubGlobal("ClipboardItem", class { constructor(readonly items: Record<string, Blob>) { written.push(items); } });
    const write = vi.fn(async () => {});
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { clipboard: { write, writeText } });
    expect(await copyMessage("**bold** move")).toBe("copied");
    expect(write).toHaveBeenCalledOnce();
    expect(writeText).not.toHaveBeenCalled();
    expect(Object.keys(written[0]!).sort()).toEqual(["text/html", "text/plain"]);
    expect(await written[0]!["text/plain"]!.text()).toBe("bold move");
    expect(await written[0]!["text/html"]!.text()).toBe("<p><strong>bold</strong> move</p>");
  });

  it("falls back to clean plain text when rich writes are refused", async () => {
    vi.stubGlobal("ClipboardItem", class {});
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { clipboard: { write: async () => { throw new DOMException("denied", "NotAllowedError"); }, writeText } });
    expect(await copyMessage("**bold** move")).toBe("copied");
    expect(writeText).toHaveBeenCalledWith("bold move");
  });

  it("copies nothing for an empty message", async () => {
    expect(await copyMessage("  ")).toBe("empty");
  });
});
