// messages sent with the old cite feature carry a hidden marker and a labelled quote; only the quote and comment stay
const LEGACY_CITATION = /<!--omb-citation-v1:[A-Za-z0-9_-]{1,100000}-->\n> Quoted message:\n((?:>.*(?:\n|$))+)(\nComment:\n)?/g;

export function withoutCitationMarkers(text: string): string {
  if (!text.includes("<!--omb-citation-v1:")) return text;
  return text.replace(LEGACY_CITATION, (_block, quote: string, comment?: string) => comment ? `${quote}\n` : quote).trim();
}
