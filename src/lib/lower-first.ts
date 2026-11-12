/** a sentence-case label dropped into the middle of another sentence: "Take an action" becomes "take an action", "MCP tool" stays */
export function lowerFirst(text: string): string {
  return /^[A-Z][a-z]/.test(text) ? text[0]!.toLowerCase() + text.slice(1) : text;
}
