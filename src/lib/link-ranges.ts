export type LinkRange = { start: number; end: number; href: string };

// only endings people read as a site, never a file extension such as .md, .py, .sh or .rs
const TLDS = "com|org|net|io|ai|dev|app|co|bot|me|xyz|gg|tv|us|uk|in|de|fr|jp|ca|au|nz|eu|nl|es|ch|se|be|at|dk|fi|ie|il|sg|hk|tw|kr|cn|ru|br|mx|ar|za|edu|gov|info|biz|tech|site|online|store|shop|page|cloud|design|link|blog|news|live|studio|art|ly|fm|to|so";
const ADDRESS = new RegExp(
  // a full address with a scheme or www., or a bare domain such as example.com, with an optional port and path
  `(?:\\bhttps?:\\/\\/|\\bwww\\.)[^\\s<>"'\`]+|(?<![\\w@.\\/:-])(?:[a-z\\d](?:[a-z\\d-]{0,61}[a-z\\d])?\\.)+(?:${TLDS})(?![\\w-])(?::\\d{2,5})?(?:[/?#][^\\s<>"'\`]*)?`,
  "gi",
);

/** Drops sentence punctuation a link ends beside, keeping a closing bracket the link itself opened. */
function trimEnd(text: string): string {
  let end = text.length;
  for (;;) {
    const last = text[end - 1];
    if (/[.,;:!?'"*_~]/.test(last)) { end--; continue; }
    const pairs: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
    if (last in pairs) {
      const body = text.slice(0, end);
      if (body.split(pairs[last]).length < body.split(last).length) { end--; continue; }
    }
    return text.slice(0, end);
  }
}

/** Every web address in plain text, with the link it opens: a bare domain opens over https. */
export function linkRanges(text: string): LinkRange[] {
  const ranges: LinkRange[] = [];
  for (const match of text.matchAll(ADDRESS)) {
    const value = trimEnd(match[0]);
    const start = match.index;
    if (!value || /^(?:https?:\/\/|www\.)$/i.test(value)) continue;
    ranges.push({ start, end: start + value.length, href: /^https?:\/\//i.test(value) ? value : `https://${value}` });
  }
  return ranges;
}
