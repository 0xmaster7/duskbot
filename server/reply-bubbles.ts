// One assistant text item as the chat messages it becomes: a line holding only `---`, outside a fenced code block,
// ends one message and starts the next, so an ack, a progress note and a result can come in one item.
const SEPARATOR = /^[ \t]*---[ \t]*$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/** The item's messages in order, each trimmed, empty ones dropped; the text unchanged when it has no separator. */
export function replyBubbles(text: string): string[] {
  const lines = text.split("\n");
  const parts: string[][] = [[]];
  let fence: string | null = null;
  let split = false;
  for (const line of lines) {
    const bare = line.replace(/\r$/, "");
    const opened = FENCE.exec(bare)?.[1];
    if (fence) {
      if (opened && opened[0] === fence[0] && opened.length >= fence.length && !bare.slice(bare.indexOf(opened) + opened.length).trim()) fence = null;
    } else if (opened) {
      fence = opened;
    } else if (SEPARATOR.test(bare)) {
      split = true;
      parts.push([]);
      continue;
    }
    parts.at(-1)!.push(line);
  }
  if (!split) return [text];
  return parts.map((part) => part.join("\n").trim()).filter(Boolean);
}
