// The one line under the waveform: what is being said right now, not the whole transcript. The line itself keeps its
// end in view with CSS; this keeps only the latest words, cut at a word where the language has spaces.

export const PREVIEW_MAX_CHARS = 72;
const ELLIPSIS = "…";

/** The latest words of `transcript` in at most `max` characters, led by an ellipsis when earlier words were dropped. */
export function previewText(transcript: string, max = PREVIEW_MAX_CHARS): string {
  const clean = transcript.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const tail = clean.slice(clean.length - (max - 1));
  // a cut through a word starts at the next whole word; unspaced scripts (Japanese, Chinese, Thai) keep the cut
  const space = tail.indexOf(" ");
  const cutMidWord = clean[clean.length - (max - 1) - 1] !== " ";
  const whole = cutMidWord && space !== -1 && space < tail.length - 1 ? tail.slice(space + 1) : tail.trimStart();
  return `${ELLIPSIS}${whole}`;
}

/** What a stopped session adds to the draft: the draft, a space where one is needed, then the words. */
export function joinDictation(draft: string, words: string): string {
  const said = words.trim();
  if (!said) return draft;
  if (!draft) return said;
  return /\s$/.test(draft) ? `${draft}${said}` : `${draft} ${said}`;
}
