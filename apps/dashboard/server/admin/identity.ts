// who a row in the admin is: an account with the best name, email and face it has, or a visitor or app install that never
// signed in, named for what it is instead of a placeholder.
import type { Account, Identity } from "../auth/store.ts";
import type { AnonymousRow } from "../analytics/sink.ts";
import { isAdminTestAccount } from "./test-accounts.ts";

export type PersonKind = "account" | "visitor" | "install";
/** `apple_relay`: Sign in with Apple's hide-my-email address, which forwards to the person but is not theirs to read */
export type EmailKind = "email" | "apple_relay" | "none";
export interface PersonIdentity {
  /** acct_… for an account, the visitor id, or install:<id> */
  id: string;
  kind: PersonKind;
  /** never empty: the account's name, the sign-in provider's name, the email's name part, or what the anonymous person is */
  name: string;
  nameFrom: "account" | "provider" | "email" | "anonymous";
  email: string | null;
  emailKind: EmailKind;
  /** how the account signs in: email always, plus each linked provider */
  providers: string[];
  /** the provider photo; null draws the pixel mascot from `avatarSeed` */
  avatarUrl: string | null;
  /** the person's own avatar choice, when they made one */
  avatar: string | null;
  avatarSeed: string;
  /** a short plain label for the kind: "account", "site visitor, not signed in", "desktop app, not signed in" */
  label: string;
  /** a harness, reserved-domain or App Review account, hidden by default */
  test: boolean;
}

const RELAY = /@privaterelay\.appleid\.com$/i;

/** "pat.real-smith" from pat.real-smith@x: words a person would recognise, capitalised */
function nameOfEmail(email: string): string | null {
  const local = email.split("@")[0]?.replace(/\+.*$/, "") ?? "";
  const words = local.split(/[._-]+/).filter(word => /[a-z]/i.test(word) && !/^\d+$/.test(word));
  if (!words.length) return null;
  return words.map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(" ");
}

export function accountIdentity(account: Pick<Account, "id" | "email" | "name" | "avatarUrl" | "avatar">, identities: ReadonlyArray<Pick<Identity, "provider" | "label" | "email">>,
  reviewEmail: string | null = null): PersonIdentity {
  const email = account.email?.trim() || null;
  const emailKind: EmailKind = !email ? "none" : RELAY.test(email) ? "apple_relay" : "email";
  const providerName = identities.map(row => row.label?.trim()).find(label => !!label && !label.includes("@")) ?? null;
  const own = account.name?.trim() || null;
  const fromEmail = email && emailKind === "email" ? nameOfEmail(email) : null;
  const [name, nameFrom] = own ? [own, "account" as const] : providerName ? [providerName, "provider" as const]
    : fromEmail ? [fromEmail, "email" as const] : [emailKind === "apple_relay" ? "Apple user (hidden email)" : "Account without a name", "anonymous" as const];
  const providers = ["email", ...new Set(identities.map(row => row.provider))];
  return { id: account.id, kind: "account", name, nameFrom, email, emailKind, providers, avatarUrl: account.avatarUrl ?? null, avatar: account.avatar ?? null,
    avatarSeed: account.id, label: "account", test: isAdminTestAccount(email, reviewEmail) };
}

const SYSTEM: Record<string, string> = { darwin: "macOS", win32: "Windows", linux: "Linux", ios: "iPhone", android: "Android" };

export function anonymousIdentity(row: Pick<AnonymousRow, "key" | "kind" | "city" | "country" | "device" | "os" | "platform">): PersonIdentity {
  const place = [row.city, row.country].filter(Boolean).join(", ");
  const app = row.kind === "install";
  const phone = row.platform === "ios" || row.platform === "android";
  const what = app ? `${phone ? "Phone" : "Desktop"} app on ${SYSTEM[row.platform ?? ""] ?? "an unknown system"}` : `Site visitor${row.device ? ` on ${row.device}` : ""}${row.os ? ` (${row.os})` : ""}`;
  return { id: row.key, kind: app ? "install" : "visitor", name: place ? `${what}, ${place}` : what, nameFrom: "anonymous", email: null, emailKind: "none", providers: [],
    avatarUrl: null, avatar: null, avatarSeed: row.key, label: app ? `${phone ? "phone" : "desktop"} app, not signed in` : "site visitor, not signed in", test: false };
}
