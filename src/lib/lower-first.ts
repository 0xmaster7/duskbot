/** a sentence-case label dropped into the middle of another sentence: "Take an action" becomes "take an action", "MCP tool" stays */
export function lowerFirst(text: string): string {
  return /^[A-Z][a-z]/.test(text) ? text[0]!.toLowerCase() + text.slice(1) : text;
}

/** a lowercase fragment shown on its own line in a sentence-case surface: "paused" becomes "Paused", "iOS" stays */
export function upperFirst(text: string): string {
  return /^[a-z][a-z\s]/.test(text) ? text[0]!.toUpperCase() + text.slice(1) : text;
}
