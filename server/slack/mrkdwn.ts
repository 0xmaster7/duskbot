function escapeText(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function toSlackMrkdwn(markdown: string): string {
  const saved: string[] = [];
  let marker = "\u0000slack";
  while (markdown.includes(marker)) marker += "_";
  const keep = (text: string) => `${marker}${saved.push(text) - 1}\u0000`;
  let text = markdown.replace(/^([ \t]*)```[^\n]*\n[\s\S]*?(?:^[ \t]*```[ \t]*(?=\n|$)|$(?![\s\S]))/gm,
    (block) => keep(block.replace(/^([ \t]*)```[^\n]*/, "$1```")));
  const lines = text.split("\n");
  const separator = (line: string) => /^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(line);
  for (let i = 0; i < lines.length - 1; i++) {
    if (!lines[i]!.includes("|") || !separator(lines[i + 1]!)) continue;
    let end = i + 2;
    while (end < lines.length && lines[end]!.includes("|") && lines[end]!.trim()) end++;
    lines.splice(i, end - i, keep(`\`\`\`\n${lines.slice(i, end).join("\n")}\n\`\`\``));
  }
  text = lines.join("\n").replace(/`[^`\n]*`/g, keep);
  text = text.replace(/!?\[([^\]\n]*)\]\(([^)\n]+)\)|<(https?:\/\/[^>\n]+)>/g, (whole, label: string | undefined, url: string | undefined, auto: string | undefined) => {
    if (auto) return keep(`<${escapeText(auto)}>`);
    const target = url!;
    return keep(/^(?:https?:\/\/|mailto:)/i.test(target) || whole.startsWith("!")
      ? `<${escapeText(target)}|${escapeText(label!)}>` : `${escapeText(label!)} (${escapeText(target)})`);
  });
  text = escapeText(text)
    .replace(/^[ \t]*(?:---|\*\*\*|___)[ \t]*(?:\n|$)/gm, "")
    .replace(/^([ \t]*)[-*+]([ \t]+)/gm, "$1•$2")
    .replace(/^ {0,3}#{1,6}[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/gm, (_, title: string) => keep(`*${title}*`))
    .replace(/\*\*([^\n]+?)\*\*|__([^\n]+?)__/g, (_, stars: string | undefined, underscores: string | undefined) => keep(`*${stars ?? underscores}*`))
    .replace(/\*([^*\n]+)\*|_([^_\n]+)_/g, (_, stars: string | undefined, underscores: string | undefined) => `_${stars ?? underscores}_`)
    .replace(/~~([^\n]+?)~~/g, "~$1~")
    .replace(/^([ \t]*)(?:&gt;)+/gm, (quote) => quote.replaceAll("&gt;", ">"));
  const token = new RegExp(`${marker}(\\d+)\u0000`, "g");
  while (text.includes(marker)) text = text.replace(token, (_, index: string) => saved[Number(index)]!);
  return text;
}

export function splitSlackText(text: string, limit = 3900): string[] {
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError("Slack text limit must be a positive integer.");
  if (!text) return [];
  if (text.includes("```") && limit < 9) throw new RangeError("Slack text limit is too small for code fences.");
  const chunks: string[] = [];
  let open = false;
  while (text) {
    const prefix = open ? "```\n" : "";
    const fences = [...text.matchAll(/```/g)].map((match) => match.index);
    const stateAt = (end: number) => open !== (fences.filter((at) => at + 3 <= end).length % 2 === 1);
    const fits = (end: number) => end > 0 && !fences.some((at) => at < end && at + 3 > end) &&
      prefix.length + end + (stateAt(end) ? 4 : 0) <= limit;
    let size = Math.min(text.length, limit - prefix.length);
    while (!fits(size)) size--;
    if (size < text.length) {
      for (const delimiter of ["\n\n", "\n", " "]) {
        let at = text.lastIndexOf(delimiter, size - delimiter.length);
        while (at >= 0 && !fits(at + delimiter.length)) at = at === 0 ? -1 : text.lastIndexOf(delimiter, at - 1);
        if (at >= 0) { size = at + delimiter.length; break; }
      }
    }
    const nextOpen = stateAt(size);
    chunks.push(prefix + text.slice(0, size) + (nextOpen ? "\n```" : ""));
    text = text.slice(size);
    open = nextOpen;
  }
  return chunks;
}

export function fromSlackText(text: string, name: (userId: string) => string | undefined): string {
  return text
    .replace(/<@([A-Za-z0-9]+)(?:\|[^>]*)?>/g, (_, id: string) => `@${name(id) || id}`)
    .replace(/<#([A-Za-z0-9]+)(?:\|([^>]+))?>/g, (_, id: string, label: string | undefined) => `#${label || id}`)
    .replace(/<((?:https?:\/\/|mailto:)[^>|]+)(?:\|([^>]*))?>/g, (_, url: string, label: string | undefined) => {
      const address = url.replace(/^mailto:/, "");
      return !label || label === address || label === url ? address : `${label} (${address})`;
    })
    .replace(/<!(here|channel|everyone)>/g, "@$1")
    .replace(/<!subteam\^[^>|]+\|([^>]+)>/g, "$1")
    .replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
}

export function stripBotMention(text: string, botUserId: string): string {
  return text.replace(/<@([^>|]+)(?:\|[^>]*)?>/g, (mention, id: string) => id === botUserId ? "" : mention).trim();
}
