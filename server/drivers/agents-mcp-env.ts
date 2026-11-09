import { TOOL_BRIDGE_ENV } from "./agents-bridge.ts";
import { TOOL_LIMIT_ENV } from "../tool-count-limit.ts";

/** The settings the harness gives the agents MCP server, and the only ones a request may carry over HTTP. */
export const AGENTS_MCP_ENV = ["DUSK_BOT_ID", "DUSK_THREAD_ID", "DUSK_TURN_DEPTH", "DUSK_EXTERNAL_RUNTIME", "DUSK_CHIEF_OF_STAFF",
  "DUSK_SKILL_AUTHORING_ENABLED", "DUSK_MEMORY_ENABLED", "DUSK_CLOUD_HOME", "DUSK_VOICE_NOTES",
  "DUSK_X_RESEARCH", "DUSK_RESEARCH", "DUSK_SLACK", "DUSK_TEAM_PEOPLE", "DUSK_DEFAULT_BOT", "DUSK_COMPUTER_SELECTION", "DUSK_ROOM", TOOL_BRIDGE_ENV, TOOL_LIMIT_ENV] as const;
