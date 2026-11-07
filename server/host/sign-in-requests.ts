// request_sign_in's card: the person signs in themselves where the bot works, for what no saved login can fill.
import type { Surface } from "../../shared/wire.ts";
import { isPendingSignInRequest, normalizeSignInSite } from "../../shared/sign-in-request.ts";
import type { ComputerControl } from "../computer-control.ts";
import { signInCardText } from "../connector-card-text.ts";
import type { BotRecord, GroupRecord, Store } from "../store.ts";

export interface SignInRequestDeps {
  store: Pick<Store, "appendMessage" | "activePath" | "patchMessage">;
  connectorThread(botId: string, threadId: string): { bot: BotRecord; group: GroupRecord | undefined } | null;
  signInPlace(bot: BotRecord, threadId: string): Surface | null;
  threadLanguage(threadId: string): string | undefined;
  followCard(threadId: string, from: string, to: string): void;
  computerControl: Pick<ComputerControl, "settleHelp" | "requestHelp">;
  signInControlKey(bot: BotRecord, threadId: string, place: Surface): string;
}

export function createSignInRequests(deps: SignInRequestDeps) {
  /** Appends the new card first, so a failed append leaves the older one actionable. */
  function requestSignIn(from: BotRecord, threadId: string, rawSite: unknown, rawReason: unknown):
    { messageId: string; site: string; place: Surface } | { status: number; error: string } {
    const owner = deps.connectorThread(from.id, threadId);
    if (!owner) return { status: 403, error: "source conversation does not belong to sender" };
    const target = normalizeSignInSite(rawSite);
    if (!target) return { status: 400, error: "site must be a web address or a domain, such as example.com" };
    const place = deps.signInPlace(from, threadId);
    if (!place) return { status: 409, error: "this conversation has no browser or computer for the person to sign in on" };
    const reason = typeof rawReason === "string" ? rawReason.trim().slice(0, 240) : "";
    const message = deps.store.appendMessage(threadId, {
      role: "bot",
      kind: "signin",
      text: signInCardText(from.name, target.site, deps.threadLanguage(threadId)),
      ...(owner.group ? { from: { botId: from.id, name: from.name, color: from.color } } : {}),
      signIn: { url: target.url, site: target.site, place, ...(reason ? { reason } : {}) },
    });
    for (const prior of deps.store.activePath(threadId)) {
      if (prior.id === message.id || !prior.signIn || !isPendingSignInRequest(prior, target.site, from.id, Boolean(owner.group))) continue;
      deps.store.patchMessage(threadId, prior.id, { signIn: { ...prior.signIn, superseded: true } }); deps.followCard(threadId, prior.id, message.id);
      deps.computerControl.settleHelp(prior.id);
    }
    deps.computerControl.requestHelp(deps.signInControlKey(from, threadId, place), `sign in to ${target.site}`,
      { botId: from.id, threadId, messageId: message.id, site: target.site, place });
    return { messageId: message.id, site: target.site, place };
  }

  return { requestSignIn };
}
