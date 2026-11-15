// "Bring what you already use": the skills and MCP servers of a person's other AI tools that the welcome flow finds
// on this computer and brings in.

export type SetupSource = "claudeCode" | "claudeDesktop" | "cursor" | "codex" | "gemini" | "windsurf" | "vscode" | "openhands";
/** Skills come as skill folders, and as the tools' own saved commands, prompts and workflows made into skills. */
export type SkillSource = Extract<SetupSource, "claudeCode" | "codex" | "gemini" | "windsurf" | "openhands">;
export const SETUP_SOURCES = ["claudeCode", "claudeDesktop", "cursor", "codex", "gemini", "windsurf", "vscode", "openhands"] as const satisfies readonly SetupSource[];
/** A tool whose standing instructions (CLAUDE.md, AGENTS.md, GEMINI.md, global rules) live in one file. */
export type InstructionsSource = Extract<SetupSource, "claudeCode" | "codex" | "gemini" | "windsurf">;

/** Names only, never a file's contents or an env or header value. Everything listed is new here. */
export interface SetupDetection {
  skills: Array<{ name: string; source: SkillSource }>;
  tools: Array<{ name: string; source: SetupSource }>;
  /** Instruction files new or changed since they were last brought in, by the file's own name. */
  instructions?: Array<{ name: string; source: InstructionsSource }>;
  /** Notes not brought in yet from each tool's own memory and standing-instructions files, counted, never shown. */
  memory?: Array<{ source: InstructionsSource; files: number; notes: number }>;
}

export interface SetupImportRequest {
  skills?: boolean;
  tools?: boolean;
  instructions?: boolean;
  /** The tools' memory and instructions, as unverified imported notes in this bot's memory. */
  memory?: boolean;
  memoryBot?: string;
  /** Only these tools' things; absent means every tool's. */
  sources?: SetupSource[];
}

export type SkillSkip = "conflict" | "failed";
/** "conflict": a different server already has that name here; "failed": it could not be saved. */
export type ToolSkip = "limit" | "policy" | "busy" | "conflict" | "failed";

/** Names and counts only. `review`: skills added switched off, because the scan flagged them, until a person reads them. */
export interface SetupImportResult {
  skills?: { added: string[]; present: string[]; skipped: Array<{ name: string; reason: SkillSkip }>; filesLeftOut: number; review: string[] };
  tools?: { added: string[]; present: string[]; skipped: Array<{ name: string; reason: ToolSkip }> };
  /** The files' text, credentials redacted, for the first bot's memory; recorded as brought in once read. */
  instructions?: Array<{ name: string; source: InstructionsSource; text: string }>;
  /** Notes added to the bot's memory, and the tools they came from. */
  memory?: { added: number; sources: InstructionsSource[]; failed: boolean };
}

export function detectionCount(detection: SetupDetection | null | undefined): number {
  return detection ? detection.skills.length + detection.tools.length + (detection.instructions?.length ?? 0) + (detection.memory?.length ?? 0) : 0;
}

/** Each source once, in the order first found. */
export function detectionSources<Source extends SetupSource>(items: ReadonlyArray<{ source: Source }>): Source[] {
  return [...new Set(items.map((item) => item.source))];
}
