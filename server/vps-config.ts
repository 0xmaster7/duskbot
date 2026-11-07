import { z } from "zod";

const SSH_ALIAS = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;

export function isValidSshAlias(value: unknown): value is string {
  return typeof value === "string" && SSH_ALIAS.test(value);
}

export interface VpsConfig {
  /** A validated SSH config alias; unset uses the linked server's local daemon when available. */
  sshAlias?: string;
  /** Personal workspaces share one desktop by default; per-bot mode retains separate existing computers. */
  mode?: "shared" | "per-bot";
  /** Permit initializing or waking the selected computer when a bot needs it; default true. */
  autoStart?: boolean;
  /** Separate bot displays and Chromium profiles inside the shared computer; default true. Files still share a home, and every screen runs as the same desktop user, so screens are separate sign-ins, not private from each other. */
  independentScreens?: boolean;
  /** Maximum active bot displays, from 1 to 20; default 20. Screens are allocated on demand. */
  maxScreens?: number;
  /** Stop an unused desktop after this many minutes; zero disables automatic idle stop. Default 10. */
  idleTimeoutMinutes?: 0 | 5 | 10 | 30;
}

export const vpsConfigSchema = z.object({
  sshAlias: z.string().refine((value) => value === "" || isValidSshAlias(value), { message: "must be a simple SSH config alias" }).optional(),
  mode: z.enum(["shared", "per-bot"]).optional(),
  autoStart: z.boolean().optional(),
  independentScreens: z.boolean().optional(),
  maxScreens: z.number().int().min(1).max(20).optional(),
  idleTimeoutMinutes: z.union([z.literal(0), z.literal(5), z.literal(10), z.literal(30)]).optional(),
});

export function normalizeVpsConfig(raw: unknown): VpsConfig {
  if (raw === undefined || raw === null) return {};
  const parsed = vpsConfigSchema.safeParse(raw);
  if (!parsed.success) throw new Error("vps requires a valid SSH config alias and computer preferences");
  const normalized = { ...parsed.data };
  if (normalized.sshAlias === "") delete normalized.sshAlias;
  return normalized;
}

export function mergeVpsConfig(current: VpsConfig | undefined, patch: VpsConfig): VpsConfig {
  return normalizeVpsConfig({ ...current, ...patch });
}
