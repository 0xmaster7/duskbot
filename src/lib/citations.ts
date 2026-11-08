// messages sent with the old cite feature carry a hidden marker and a labelled quote; only the quote and comment stay
const LEGACY_CITATION = /<!--omb-citation-v1:[A-Za-z0-9_-]{1,100000}-->\n> Quoted message:\n((?:>.*(?:\n|$))+)(\nComment:\n)?/g;

export function withoutCitationMarkers(text: string): string {
  if (!text.includes("<!--omb-citation-v1:")) return text;
  return text.replace(LEGACY_CITATION, (_block, quote: string, comment?: string) => comment ? `${quote}\n` : quote).trim();
}

// a search snippet can cut the marker anywhere, so any piece of it goes, with the label
export function withoutCitationTraces(text: string): string {
  if (!/-->|omb-citation-v1|Quoted message:/.test(text)) return text;
  return text
    .replace(/<!--omb-citation-v1:[A-Za-z0-9_-]*(?:-->)?\s*/g, "")
    .replace(/^(\.{3}|…)?[A-Za-z0-9_-]{8,}-->\s*/, "$1")
    .replace(/>\s*Quoted message:\s*/g, "");
}
