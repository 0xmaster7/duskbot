// What of a memory file counts as current: its entry lines, without frontmatter, headings, struck-through history or
// the archive (older and no-longer-true notes that never load).
const STRUCK = /^\s*(?:[-*]\s+)?~~[\s\S]*~~/;
const HISTORY_FILES = /^memory\/archive\.md$/;

export function activeEntries(text: string, source: string): Array<{ source: string; text: string }> {
  const out: Array<{ source: string; text: string }> = [];
  let frontmatter = false;
  text.split("\n").forEach((raw, i) => {
    const line = raw.trim();
    if (i === 0 && line === "---") { frontmatter = true; return; }
    if (frontmatter) { if (line === "---") frontmatter = false; return; }
    if (!line || line.startsWith("#") || STRUCK.test(line) || /· superseded \d{4}-\d{2}-\d{2}/.test(line)) return;
    // a bot file's notes are its bullets (the rest is the file's own preamble); a line ending in ":" is a heading
    if ((source !== "shared" && !/^[-*]\s/.test(line)) || line.endsWith(":")) return;
    // the chat a note came from is named by its title, the chat's first words: a label, not something remembered
    out.push({ source, text: line.replace(/ · from (?:chat|room) "[^"\n]*"(?: \(noticed\))?/, "") });
  });
  return out;
}

export function activeText(files: Record<string, string>): string {
  return Object.entries(files)
    .filter(([path]) => !HISTORY_FILES.test(path))
    .map(([path, text]) => {
      const lines = activeEntries(text, path).map((entry) => entry.text);
      return lines.length ? `### ${path}\n${lines.join("\n")}` : "";
    })
    .filter(Boolean)
    .join("\n");
}

/** Facts stored more than once across every tier, after dates, sources and spacing: the same line kept twice. */
export function duplicateFacts(entries: ReadonlyArray<{ text: string }>): number {
  const fold = (text: string) => text.replace(/^\s*-\s*\d{4}-\d{2}-\d{2} · (?:learned by [^·]* · )?/, "").replace(/^\s*[-*]\s+/, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const seen = new Map<string, number>();
  for (const entry of entries) seen.set(fold(entry.text), (seen.get(fold(entry.text)) ?? 0) + 1);
  return [...seen.values()].reduce((sum, count) => sum + count - 1, 0);
}
