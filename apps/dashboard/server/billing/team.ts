import { createHash, randomBytes } from "node:crypto";
import type { LicenseView, TeamView } from "../../../../shared/billing-api.ts";
import type { CloudsService, StoredCloud } from "../clouds/types.ts";
import type { BillingConfig } from "./plans.ts";
import type { BillingStore, TeamInvite } from "./store.ts";
import { BillingError } from "./service.ts";
import type { AccountRef } from "./types.ts";

export const INVITE_TTL_MS = 7 * 86_400_000;
/** invites one team may send a day, resends included */
export const INVITES_PER_DAY = 20;
const LEAVE_GIVE_UP_MS = 7 * 86_400_000;
const EMAIL = /^[^\s@<>()[\]\\,;:"]{1,64}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

export type TeamMail =
  | { kind: "invite"; to: string; team: string; from: string; token: string; expiresAt: number }
  | { kind: "seat_full"; to: string; team: string; email: string; seats: number };

export interface TeamOptions {
  store: BillingStore; clouds: CloudsService; config: BillingConfig; now(): number;
  /** an account's display name, when it has one */
  accountName?(accountId: string): string | null;
  /** an account's address, to tell the owner */
  accountEmail?(accountId: string): string | null;
  /** delivery failures are the mailer's to log; never thrown here */
  mail?(message: TeamMail): void;
}

const fail = (status: number, code: string): never => { throw new BillingError(status, code as never); };
const hash = (token: string) => createHash("sha256").update(token).digest("hex");
export function teamEmail(value: unknown): string {
  if (typeof value !== "string") fail(400, "invalid_request");
  const email = (value as string).trim().toLowerCase();
  if (email.length > 254 || !EMAIL.test(email)) fail(400, "invalid_request");
  return email;
}

export function createTeams(options: TeamOptions) {
  const { store, clouds, config, now } = options;
  const state = store.state;
  const invites = () => (state.teamInvites ??= []);
  const leaves = () => (state.teamLeaves ??= []);
  const live = (license: LicenseView) => license.kind === "team" && ["active", "grace"].includes(license.status) && license.validUntil !== null && now() < license.validUntil;
  const subscriptionOf = (license: LicenseView) => state.subscriptions.find(sub => sub.licenseId === license.id && sub.status !== "ended") ?? null;
  function cloudOf(license: LicenseView): StoredCloud | null {
    const cloudId = subscriptionOf(license)?.cloudId;
    const cloud = cloudId ? clouds.get(cloudId) : null;
    return cloud && cloud.status !== "destroyed" && cloud.status !== "destroying" ? cloud : null;
  }
  /** the live team this account owns or belongs to */
  function teamOf(account: AccountRef): LicenseView | null {
    return state.licenses.find(license => live(license) && (license.ownerAccountId === account.id || license.members.some(member => member.accountId === account.id))) ?? null;
  }
  function owned(account: AccountRef): LicenseView {
    const license = teamOf(account);
    if (!license) fail(404, "not_found");
    if (license!.ownerAccountId !== account.id) fail(403, "forbidden");
    return license!;
  }
  const pending = (license: LicenseView) => invites().filter(invite => invite.licenseId === license.id && invite.status === "pending" && invite.expiresAt > now());
  const teamName = (license: LicenseView) => cloudOf(license)?.team?.name ?? `${(options.accountEmail?.(license.ownerAccountId) ?? "").split("@")[0] || "your"}'s team`;

  function view(license: LicenseView, account: AccountRef): TeamView {
    const owner = license.ownerAccountId === account.id, sub = subscriptionOf(license), cloud = cloudOf(license), option = config.licenses.team;
    const ownerRow = license.members.find(member => member.role === "owner");
    const changing = sub?.pendingChange?.cart.license.kind === "team" ? sub.pendingChange.cart.license.members ?? null : null;
    return {
      v: 1, id: license.id, name: teamName(license), role: owner ? "owner" : "member",
      owner: { email: ownerRow?.email ?? options.accountEmail?.(license.ownerAccountId) ?? "", name: options.accountName?.(license.ownerAccountId) ?? null },
      seats: { used: license.members.length, pending: pending(license).length, paid: license.seats, included: option.includedMembers ?? 1, max: option.maxMembers ?? license.seats,
        changing: changing !== null && changing !== license.seats ? changing : null, extraSeatCents: option.extraMemberCents ?? 0, interval: sub?.cart.interval ?? "month" },
      members: license.members.map(member => ({ email: member.email, name: member.accountId ? options.accountName?.(member.accountId) ?? null : null, role: member.role, joinedAt: member.addedAt,
        you: member.accountId === account.id })).sort((a, b) => Number(b.role === "owner") - Number(a.role === "owner") || a.joinedAt - b.joinedAt),
      invites: owner ? pending(license).map(invite => ({ id: invite.id, email: invite.email, createdAt: invite.createdAt, expiresAt: invite.expiresAt, refusedAt: invite.refusedAt }))
        .sort((a, b) => a.createdAt - b.createdAt) : [],
      cloud: cloud ? { id: cloud.id, name: cloud.name, joinable: !!cloud.team } : null,
      subscriptionId: owner ? sub?.id ?? null : null,
    };
  }

  function get(account: AccountRef): TeamView | null {
    const license = teamOf(account);
    return license ? view(license, account) : null;
  }

  function invite(account: AccountRef, input: unknown): TeamView {
    const license = owned(account), email = teamEmail(input);
    if (license.members.some(member => member.email === email)) fail(409, "already_in_team");
    const open = pending(license), again = open.find(invite => invite.email === email);
    if (invites().filter(invite => invite.licenseId === license.id && invite.createdAt > now() - 86_400_000).length >= INVITES_PER_DAY) fail(429, "rate_limited");
    if (!again && license.members.length + open.length >= license.seats) fail(409, "seats_full");
    if (again) { again.status = "cancelled"; again.closedAt = now(); }
    const token = randomBytes(32).toString("base64url");
    const row: TeamInvite = { id: `inv_${randomBytes(12).toString("hex")}`, licenseId: license.id, email, tokenHash: hash(token), invitedBy: account.id, createdAt: now(),
      expiresAt: now() + INVITE_TTL_MS, status: "pending", closedAt: null, refusedAt: null };
    invites().push(row);
    store.commit();
    const from = options.accountName?.(account.id) || account.email;
    options.mail?.({ kind: "invite", to: email, team: teamName(license), from, token, expiresAt: row.expiresAt });
    return view(license, account);
  }

  function cancel(account: AccountRef, inviteId: string): TeamView {
    const license = owned(account);
    const row = invites().find(invite => invite.id === inviteId && invite.licenseId === license.id && invite.status === "pending");
    if (!row) fail(404, "not_found");
    row!.status = "cancelled"; row!.closedAt = now();
    store.commit();
    return view(license, account);
  }

  function remove(account: AccountRef, input: string): TeamView {
    const license = owned(account), email = teamEmail(input);
    const member = license.members.find(row => row.email === email);
    if (!member) fail(404, "not_found");
    if (member!.role === "owner") fail(403, "forbidden");
    license.members = license.members.filter(row => row.email !== email);
    const cloud = cloudOf(license);
    // security: membership is what pairing checks, so access ends here; the cloud ends open sessions once told
    if (cloud?.team) leaves().push({ id: `lv_${randomBytes(12).toString("hex")}`, cloudId: cloud.id, email, at: now(), doneAt: null, tries: 0, nextAt: now() });
    store.commit();
    void drainLeaves();
    return view(license, account);
  }

  function join(account: AccountRef, token: unknown): TeamView {
    if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) fail(410, "invite_invalid");
    const row = invites().find(invite => invite.tokenHash === hash(token as string));
    const license = row ? state.licenses.find(item => item.id === row.licenseId) : undefined;
    if (!row || !license || !live(license)) fail(410, "invite_invalid");
    const already = license!.members.find(member => member.accountId === account.id);
    if (already && row!.status !== "cancelled") {
      if (row!.status === "pending") { row!.status = "accepted"; row!.closedAt = now(); store.commit(); }
      return view(license!, account);
    }
    if (row!.status !== "pending" || row!.expiresAt <= now()) fail(410, "invite_invalid");
    if (row!.email !== account.email.trim().toLowerCase()) fail(403, "invite_other_email");
    const other = teamOf(account);
    if (other && other.id !== license!.id) fail(409, "already_in_team");
    if (license!.members.length >= license!.seats) {
      if (row!.refusedAt === null) {
        row!.refusedAt = now(); store.commit();
        const to = options.accountEmail?.(license!.ownerAccountId);
        if (to) options.mail?.({ kind: "seat_full", to, team: teamName(license!), email: row!.email, seats: license!.seats });
      }
      fail(409, "seats_full");
    }
    license!.members.push({ email: row!.email, accountId: account.id, role: "member", addedAt: now() });
    row!.status = "accepted"; row!.closedAt = now();
    store.commit();
    return view(license!, account);
  }


  function membership(account: AccountRef): { cloud: StoredCloud; role: "owner" | "member"; team: string } | null {
    const license = teamOf(account), cloud = license ? cloudOf(license) : null;
    if (!license || !cloud?.team) return null;
    return { cloud, role: license.ownerAccountId === account.id ? "owner" : "member", team: cloud.team.name };
  }

  let draining: Promise<void> | null = null;
  /** retried with backoff until the cloud confirms, for a week */
  function drainLeaves(): Promise<void> {
    if (draining) return draining;
    draining = (async () => {
      for (const row of leaves().filter(item => item.doneAt === null && item.nextAt <= now())) {
        try {
          await clouds.memberLeft(row.cloudId, row.email);
          row.doneAt = now();
        } catch {
          row.tries++;
          if (now() - row.at > LEAVE_GIVE_UP_MS) { row.doneAt = now(); console.warn(`team: gave up telling cloud ${row.cloudId} a member left`); }
          else row.nextAt = now() + Math.min(3_600_000, 30_000 * 2 ** Math.min(row.tries, 7));
        }
      }
      state.teamLeaves = leaves().filter(item => item.doneAt === null || item.doneAt > now() - 30 * 86_400_000);
      store.commit();
    })().finally(() => { draining = null; });
    return draining;
  }
  const timer = setInterval(() => { if (leaves().some(row => row.doneAt === null)) void drainLeaves(); }, 60_000);
  timer.unref();

  return { get, invite, cancel, remove, join, membership, drainLeaves, close() { clearInterval(timer); } };
}
export type Teams = ReturnType<typeof createTeams>;
