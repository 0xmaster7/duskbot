import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { plainMarkdownElements } from "@/components/ChatMarkdown";
import { copyRichText, type CopyResult } from "./copy-text";

const BLOCKS = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "div", "section", "pre", "table", "ul", "ol"]);

const taskMark = (box: HTMLInputElement) => (box.checked ? "☑" : "☐");

function inline(node: Node): string {
  return [...node.childNodes].map(plainText).join("");
}

function listItem(item: Element, marker: string): string {
  const body = inline(item).trim().replace(/\n{2,}/g, "\n");
  const indent = " ".repeat(marker.length);
  return marker + body.split("\n").map((line, index) => (index && line ? indent + line : line)).join("\n");
}

function plainText(node: Node): string {
  if (node.nodeType === 3) {
    const value = node.textContent ?? "";
    // mdast-util-to-hast writes a newline after every <br>
    return node.previousSibling?.nodeName === "BR" ? value.replace(/^\n/, "") : value;
  }
  if (node.nodeType !== 1) return "";
  const element = node as Element;
  const tag = element.tagName.toLowerCase();
  if (tag === "br") return "\n";
  if (tag === "hr") return "\n\n";
  if (tag === "img") return element.getAttribute("alt") ?? "";
  if (tag === "input") return taskMark(element as HTMLInputElement);
  if (tag === "a") {
    const label = inline(element);
    const href = element.getAttribute("href") ?? "";
    return href && !href.startsWith("#") && href !== label && `mailto:${label}` !== href ? `${label} (${href})` : label;
  }
  if (tag === "pre") return `\n\n${(element.textContent ?? "").replace(/\n$/, "")}\n\n`;
  if (tag === "ul" || tag === "ol") {
    const start = Number(element.getAttribute("start") ?? 1) || 1;
    const items = [...element.children].filter((child) => child.tagName.toLowerCase() === "li");
    return `\n\n${items.map((item, index) => listItem(item, tag === "ol" ? `${start + index}. ` : item.querySelector(":scope > input, :scope > p:first-child > input") ? "" : "• ")).join("\n")}\n\n`;
  }
  if (tag === "table") {
    const rows = [...element.querySelectorAll("tr")].map((row) => [...row.children].map((cell) => inline(cell).replace(/\s*\n\s*/g, " ").trim()).join("\t"));
    return `\n\n${rows.join("\n")}\n\n`;
  }
  const text = inline(element);
  return BLOCKS.has(tag) ? `\n\n${text}\n\n` : text;
}

/** The markup a mail or document editor keeps: the app's classes go, and task boxes become the marks they show. */
function cleanHtml(rendered: Element): string {
  const marks = [...rendered.querySelectorAll("input")].map(taskMark);
  const copy = rendered.cloneNode(true) as Element;
  copy.querySelectorAll("input").forEach((box, index) => box.replaceWith(marks[index] ?? ""));
  for (const element of copy.querySelectorAll("[class]")) element.removeAttribute("class");
  return copy.innerHTML;
}

/** A message's words twice: rendered HTML, and plain text with no markdown symbols left in it. */
export function messageClipboard(markdown: string): { html: string; text: string } {
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    flushSync(() => root.render(plainMarkdownElements(markdown)));
    const text = plainText(host).replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    return { text, html: cleanHtml(host) };
  } finally {
    root.unmount();
  }
}

export function copyMessage(markdown: string): Promise<CopyResult> {
  if (!markdown.trim()) return Promise.resolve("empty");
  const { text, html } = messageClipboard(markdown);
  return copyRichText(text || markdown, html);
}
