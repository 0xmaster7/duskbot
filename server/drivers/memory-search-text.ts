import type { Json } from "./agents-client.ts";

export function memorySearchText(memoryHits: readonly Json[]): string {
  return memoryHits.length
    ? `${memoryHits.length} matching memory file${memoryHits.length === 1 ? "" : "s"} of yours:\n${memoryHits.map(hit => `- [memory file ${String(hit.file)}] ${String(hit.snippet)}`).join("\n")}\n\n`
    : "";
}
