import { z } from "zod";

const SSH_ALIAS = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const invalidPreferences = (message: string) => Object.assign(new Error(message), { status: 400 });

export function isValidSshAlias(value: unknown): value is string {
  return typeof value === "string" && SSH_ALIAS.test(value);
}

export interface VpsLifecyclePolicy {
  browserIdleMinutes: number;
  screenIdleMinutes: number;
  computerIdleMinutes: number;
}
const lifecycleMinutes = z.number().int().min(0).max(43_200);
export const vpsLifecycleSchema = z.object({
  browserIdleMinutes: lifecycleMinutes.optional(),
  screenIdleMinutes: lifecycleMinutes.optional(),
  computerIdleMinutes: lifecycleMinutes.optional(),
});
export function vpsLifecyclePolicy(vps: Pick<VpsConfig, "idleTimeoutMinutes" | "lifecycle"> = {}): VpsLifecyclePolicy {
  const legacy = vps.idleTimeoutMinutes;
  const policy = { browserIdleMinutes: legacy ?? 180, screenIdleMinutes: legacy ?? 1440, computerIdleMinutes: legacy ?? 2880, ...vps.lifecycle };
  if (Object.values(policy).some(value => !Number.isInteger(value) || value < 0 || value > 43_200)) throw invalidPreferences("VPS lifecycle minutes must be integers from zero to 43200");
  const enabled = Object.values(policy).filter(value => value > 0);
  if (enabled.some((value, index) => index > 0 && value < enabled[index - 1]!)) throw invalidPreferences("VPS lifecycle stages must be ordered from browser to screen to computer");
  return policy;
}

export interface VpsConfig {
  /** A validated SSH config alias; unset uses the linked server's local daemon when available. */
  sshAlias?: string;
  /** Personal workspaces share one desktop by default; per-bot mode retains separate existing computers. */
  mode?: "shared" | "per-bot";
  /** Permit initializing or waking the selected computer when a bot needs it; default true. */
  autoStart?: boolean;
  /** Separate bot displays and Chromium profiles inside the shared computer; default true. Files still share a home. */
  independentScreens?: boolean;
  /** Maximum active bot displays, from 1 to 20; default 20. Screens are allocated on demand. */
  maxScreens?: number;
  /** Compatibility choice supplying unspecified lifecycle stages; zero disables those stages. */
  idleTimeoutMinutes?: 0 | 5 | 10 | 30;
  /** Idle minutes before closing browsers, screens and the owned computer container; zero disables a stage. */
  lifecycle?: Partial<VpsLifecyclePolicy>;
}

export const vpsConfigSchema = z.object({
  sshAlias: z.string().refine((value) => value === "" || isValidSshAlias(value), { message: "must be a simple SSH config alias" }).optional(),
  mode: z.enum(["shared", "per-bot"]).optional(),
  autoStart: z.boolean().optional(),
  independentScreens: z.boolean().optional(),
  maxScreens: z.number().int().min(1).max(20).optional(),
  idleTimeoutMinutes: z.union([z.literal(0), z.literal(5), z.literal(10), z.literal(30)]).optional(),
  lifecycle: vpsLifecycleSchema.optional(),
}).superRefine((value, context) => {
  const enabled = (["browserIdleMinutes", "screenIdleMinutes", "computerIdleMinutes"] as const).map(key => value.lifecycle?.[key]).filter((minutes): minutes is number => minutes !== undefined && minutes > 0);
  if (enabled.some((minutes, index) => index > 0 && minutes < enabled[index - 1]!)) context.addIssue({ code: "custom", path: ["lifecycle"], message: "enabled lifecycle stages must be ordered from browser to screen to computer" });
});

export function normalizeVpsConfig(raw: unknown): VpsConfig {
  if (raw === undefined || raw === null) return {};
  const parsed = vpsConfigSchema.safeParse(raw);
  if (!parsed.success) throw invalidPreferences(parsed.error.issues.some(issue => issue.message.includes("ordered"))
    ? "VPS lifecycle stages must be ordered from browser to screen to computer" : "vps requires a valid SSH config alias and computer preferences");
  const normalized = { ...parsed.data };
  vpsLifecyclePolicy(normalized);
  if (normalized.sshAlias === "") delete normalized.sshAlias;
  return normalized;
}

export function mergeVpsConfig(current: VpsConfig | undefined, patch: VpsConfig): VpsConfig {
  return normalizeVpsConfig({ ...current, ...patch, ...((current?.lifecycle || patch.lifecycle) ? { lifecycle: { ...current?.lifecycle, ...patch.lifecycle } } : {}) });
}
