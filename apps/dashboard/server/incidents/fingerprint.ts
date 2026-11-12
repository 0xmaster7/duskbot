import { createHash } from "node:crypto";
import { scrubText, stackFrames } from "../../../../electron/error-report.mjs";
import type { ErrorFrame } from "../../../../electron/error-report.mjs";

/** where an incident came from: the service itself, or a client that posted to /v1/errors */
export const SERVER_SOURCES = ["server", "process", "log", "database", "upstream", "test"] as const;
export const CLIENT_SOURCES = ["web", "admin", "desktop", "desktop-main"] as const;
export type ClientSource = (typeof CLIENT_SOURCES)[number];
export type IncidentSource = (typeof SERVER_SOURCES)[number] | ClientSource;
export const isClientSource = (source: string): source is ClientSource => (CLIENT_SOURCES as readonly string[]).includes(source);

// the service's own lines may name a cloud or a route the owner needs, so they keep ids; only secrets and addresses go
const SECRETS: Array<[RegExp, string]> = [
  [/-----BEGIN [A-Z ]+-----[\s\S]*?(-----END [A-Z ]+-----|$)/g, "[key]"],
  [/\b[Bb]earer\s+[^\s"',;]+/g, "Bearer [redacted]"],
  [/\b(sk-ant-|sk-proj-|sk-|xox[abprs]-|xapp-|xkeysib-|ghp_|github_pat_|re_|whsec_|omc_|AKIA)[A-Za-z0-9_-]{8,}/g, "[secret]"],
  [/\b([A-Za-z0-9_-]*(token|secret|password|passwd|api[_-]?key|authorization|cookie|session|code|otp)[A-Za-z0-9_-]*)(["']?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;&]+)/gi, "$1$3[redacted]"],
  [/\b(mongodb(?:\+srv)?:\/\/)[^\s"'<>]+/gi, "$1[redacted]"],
  [/\b(https?:\/\/[^\s"'<>?#]+)[?#][^\s"'<>)]*/gi, "$1?[redacted]"],
  [/\b\d{8}\b/g, "[n]"],
];
const EMAIL = /([A-Za-z0-9._%+-]{1,64})@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;

/** "siddz.dev@gmail.com" -> "si***@gmail.com": enough to tell who, not enough to copy */
export const maskEmail = (local: string, domain: string) => `${local.slice(0, 2)}***@${domain}`;

/** masks secrets, sign-in codes, query strings and email addresses in the service's own text, then trims */
export function maskText(value: unknown, max = 300): string {
  let text = String(value ?? "");
  for (const [pattern, replacement] of SECRETS) text = text.replace(pattern, replacement);
  text = text.replace(EMAIL, (_all, local: string, domain: string) => maskEmail(local, domain)).replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** a client's text can hold what a person typed: the reporter's stronger scrub (no quotes, urls, ids or addresses) */
export const clientText = (value: unknown) => scrubText(maskText(value, 500));

/** /v1/workspaces/ws_8f2k.../commands -> /v1/workspaces/:id/commands */
export function routeOf(path: string | null | undefined): string | null {
  if (!path) return null;
  const clean = path.split(/[?#]/)[0]!.replace(/[^\w./:@-]/g, "");
  const parts = clean.split("/").filter(Boolean).slice(0, 5).map(part =>
    part.length >= 16 || (/\d/.test(part) && part.length > 3 && !/^v\d+$/.test(part)) || part.includes("@") ? ":id" : part.slice(0, 40));
  return `/${parts.join("/")}`;
}

/** a bundle's content hash changes every build; the function and file it names do not */
const stableFile = (file: string) => file.replace(/[-.][A-Za-z0-9_]{8,}(?=\.m?js$)/, "");

/** the newest frame in our own code, without its line number, so a deploy does not split one bug into two */
export function topFrame(frames: ErrorFrame[]): string | null {
  const own = [...frames].reverse().find(frame => frame.in_app && !frame.filename.startsWith("node:"));
  const frame = own ?? frames.at(-1);
  return frame ? `${frame.function} (${stableFile(frame.filename)})` : null;
}

/** newest first, at most `count` lines */
export function shortStack(frames: ErrorFrame[], count = 6): string[] {
  return [...frames].reverse().slice(0, count).map(frame => `at ${frame.function} (${frame.filename}:${frame.lineno})`);
}

/** text without the parts that differ between two sightings of one problem: ids, counts, times */
export const normalize = (text: string) => text.toLowerCase().replace(/\S*\d\S*/g, "#").replace(/\[[a-z]+\]/g, "#").replace(/\s+/g, " ").trim().slice(0, 160);

export interface FingerprintInput { source: string; name: string; message: string; frames: ErrorFrame[]; route: string | null }

/** one problem, however often it happens: error name + top frame + route; a line without a stack uses its normalized text */
export function fingerprint(input: FingerprintInput): string {
  const where = topFrame(input.frames) ?? normalize(input.message);
  return createHash("sha256").update([input.source, input.name, where, input.route ?? ""].join("|")).digest("hex").slice(0, 20);
}

export { stackFrames };
