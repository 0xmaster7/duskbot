/** Skills library browse surface: one row per library entry, with the bots
 * currently assigned to it. Version is null for locally imported skills. */
export interface SkillsLibrarySkillWire {
  name: string;
  description: string;
  source: string;
  enabled: boolean;
  everyBot: boolean;
  tags: string[];
  version: string | null;
  importedAt: string;
  license?: string;
  compatibility?: string;
  warnings: string[];
  assignedBots: Array<{ id: string; name: string }>;
}

/** PUT body for a bot's assignment list: the full list, applied
 * idempotently. */
export interface BotAssignedSkillsWire {
  skills: string[];
}
