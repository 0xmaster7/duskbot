import { useEffect, useState } from "react";

import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { needsReconnect } from "@/lib/connector-status";
import { connectorSetupNotice } from "./connector-helpers";
import type { ToolkitCard } from "../ServiceIcon";
import { GrokIcon } from "../GrokIcon";
import { AppTile, CancelLink, ConnectedMark, RowPill, type RowAction } from "./AppRow";
import type { AppEntry, Connection } from "./catalog";
import type { ConnectorPhase, Connectors } from "./use-connectors";
import { COMPOSIO_AUTH_CONFIGS_URL } from "../../../shared/connector-availability";
import { composioPage, loadToolkitActions, type SnapshotToolkit, type ToolkitActions } from "./composio-snapshot";
import { ComposioKeyStep } from "./ComposioKeyStep";
import { GmailCard, gmailCard } from "./GmailCard";
import { PrimaryButton, type Primary } from "./PrimaryButton";
import type { ConnectorAccount } from "@/lib/connector-status";

/** One way an app connects, when it has more than one: our own card, the vendor's server, Composio. */
export interface Way {
  key: "own" | "remote" | "composio";
  label: string;
  connected: boolean;
  action?: Extract<RowAction, { kind: "button" }>;
}

export interface AppPageModel {
  entry: AppEntry;
  /** The app's Composio toolkit, its own id or the one folded into our card. */
  composioSlug?: string;
  ways?: Way[];
  connection: Connection;
  phase: ConnectorPhase | null;
  card: ToolkitCard | undefined;
  connectors: Connectors;
  categoryLabel: string | null;
  usedBy: string[];
  /** What Composio's catalog says about the app: how you sign in, and what it can do. */
  toolkit?: SnapshotToolkit;
  remoteClient: boolean;
  onOpenLogins: () => void;
  onOpenKeys: () => void;
  /** A vendor's own MCP server: connect signs in there, managing it is the MCP servers page. */
  remote?: { open: boolean; busy: boolean; onConnect: () => void; onCancel: () => void; onManage: () => void };
}

/** One app's page: its tile, name and main action, what it does, its accounts, and the facts about it. */
export function AppPage({ model }: { model: AppPageModel }) {
  const { entry, phase, card, connectors } = model;
  const [alias, setAlias] = useState("");
  const slug = model.composioSlug ?? entry.id;
  const composio = model.composioSlug !== undefined && card !== undefined;
  // more than one way in: each shows in the ways card, and Composio's setup waits until that one is picked
  const ways = model.ways && model.ways.length > 1 ? model.ways : null;
  const status = composio ? connectors.status[slug] : undefined;
  const accounts = status?.accounts ?? [];
  // a key is all that is missing: the key step shows right here, no trip to Settings
  const viaSignedIn = connectors.via?.signedIn === true;
  const askingKey = composio && !model.remoteClient && !viaSignedIn
    && (connectors.keyFor === slug || (!ways && !connectors.configured && !connectors.stale && connectors.setup === "needs-setup"));
  const setup = composio && !askingKey && !viaSignedIn && !ways ? connectorSetupNotice({ configured: connectors.configured, stale: connectors.stale, setup: connectors.setup, remoteClient: model.remoteClient }) : null;
  const flow = composio ? connectors.viaFlow[slug] : undefined;
  // through Composio Connect: two steps, Authorize Composio then Connect the app, and the main button is the one you are on
  const viaSteps = askingKey || (composio && !model.remoteClient && viaSignedIn && connectors.viaRoute(slug)
    && (flow !== undefined || (!ways && model.connection !== "connected")));
  const askingAlias = composio && connectors.aliasFor === slug;
  const aliasError = askingAlias && connectors.error ? (typeof connectors.error === "string" ? connectors.error : t(connectors.error.key)) : null;

  const primary = ((): Primary | null => {
    // our own card connects in its body below
    if (entry.kind !== "composio" && entry.kind !== "remote") return null;
    if (model.remote && (entry.kind === "remote" || !(connectors.configured || viaSignedIn))) {
      return model.connection === "connected"
        ? { label: t("connectApps.remote.manage"), quiet: true, onClick: model.remote.onManage }
        : { label: t("connectors.action.connect"), busy: model.remote.busy, disabled: model.connection === "unknown", onClick: model.remote.onConnect, onCancel: model.remote.onCancel };
    }
    if (!composio || !phase) return null;
    const connect: Primary = { label: t("connectApps.connectApp", { name: entry.label }), onClick: () => void connectors.connect(slug), onCancel: () => connectors.cancel(slug) };
    if (viaSteps) {
      const authorize: Primary = { label: t("connectApps.via.authorize"), signIn: true, disabled: model.remoteClient, onClick: () => void connectors.authorizeComposio(slug), onCancel: () => connectors.cancel(slug) };
      if (flow?.step === "authorizing") return { ...authorize, busy: true, busyLabel: t("connectApps.signIn.waiting") };
      if (flow?.step === "failed" && flow.why === "signedOut") return { ...authorize, label: t("connectApps.via.authorizeAgain") };
      if (!viaSignedIn) return flow?.step === "failed" ? { ...authorize, label: t("connectors.action.retry") } : authorize;
      if (flow?.step === "waiting") return { label: t("connectApps.via.openAgain"), onClick: () => connectors.reopenVia(slug), onCancel: () => connectors.cancel(slug), waiting: true };
      if (flow?.step === "failed") return { label: t("connectors.action.retry"), onClick: () => void connectors.connect(slug) };
      if (flow?.step === "done" || model.connection === "connected") return null;
      return phase.kind === "connecting" ? { ...connect, busy: true, busyLabel: t("connectApps.signIn.waiting") } : connect;
    }
    if (askingKey) return null;
    if (ways && model.connection === "connected" && phase.kind === "connect") return null;
    if (!connectors.configured && !viaSignedIn) return { ...connect, disabled: model.remoteClient, onClick: () => connectors.askKey(slug) };
    switch (phase.kind) {
      case "checking": return { ...connect, disabled: true };
      case "connecting": return { ...connect, busy: true };
      case "continue": return { label: t("connectApps.via.openAgain"), onClick: () => connectors.resume(slug), onCancel: () => connectors.cancel(slug), waiting: true };
      case "failed": return { label: t("connectors.action.retry"), onClick: () => void connectors.connect(slug) };
      case "reconnect": return { label: t("connectors.action.reconnect"), onClick: () => void connectors.connect(slug, phase.account.alias, phase.account) };
      // grok keeps Add Account with the accounts it adds to
      case "connected": return accounts.length || connectors.viaApps[slug] ? null : { label: t("connectors.action.addAccount"), quiet: true, onClick: () => { setAlias(""); connectors.askAlias(slug); } };
      case "included": return { label: t("connectors.action.included"), quiet: true, disabled: true };
      case "setup": return { ...connect, label: t("common.checkAgain") };
      case "unavailable": return { ...connect, disabled: true };
      default: return connect;
    }
  })();

  // gmail connects on one card: its promise, the one button, and where the sign-in stands
  const gmail = composio && slug === "gmail" && !ways && !model.remote && phase !== null
    ? gmailCard({
      name: entry.label, primary, connected: model.connection === "connected", via: viaSteps, viaSignedIn, flow, phase,
      ...(model.remoteClient ? {} : { onOwnKey: model.onOpenKeys }),
    })
    : null;
  const facts = appFacts(model);
  const ownCard = entry.kind !== "composio";

  return (
    <div className="ca-detail" data-app-page={entry.id}>
      <div className="ca-detail-top">
        <header className="ca-detail-header">
          <AppTile entry={entry} size={56} />
          <h3 className="ca-detail-name" data-detail-hero-title="">{entry.label}</h3>
          {!gmail && primary?.onCancel && (primary.busy || primary.waiting) && <CancelLink onCancel={primary.onCancel} />}
          {gmail ? null : primary ? <PrimaryButton primary={primary} /> : (entry.kind === "composio" || entry.kind === "remote") && model.connection === "connected" && <ConnectedMark />}
        </header>
        <p className="ca-detail-desc">{entry.description}</p>
      </div>
      <div className="ca-groups">
        {gmail && <GmailCard model={gmail} />}
        {setup && (
          <p className="ca-notice" data-tone={setup.tone === "warning" ? "danger" : undefined}>
            {t(setup.key)}{" "}
            {!model.remoteClient && <button type="button" className="ca-link" onClick={model.onOpenKeys}>{t("connectors.openSettings")}</button>}
          </p>
        )}
        {phase?.kind === "unavailable" && <p className="ca-notice">{phase.reason}</p>}
        {phase?.kind === "setup" && (
          <p className="ca-notice" data-composio-setup="">
            {/* the official broker's project cannot use the person's own auth config, their own key can */}
            {t(connectors.mode === "managed" ? "connectApps.composioSetupKey" : "connectApps.composioSetup", { name: entry.label })}{" "}
            <a className="ca-link" href={COMPOSIO_AUTH_CONFIGS_URL} target="_blank" rel="noopener noreferrer">{t("connectApps.openComposio")}</a>
            {connectors.mode === "managed" && !model.remoteClient && <>{" "}<button type="button" className="ca-link" onClick={() => connectors.askKey(slug)}>{t("connectApps.key.add")}</button></>}
          </p>
        )}
        {ways && (
          <div data-ways="">
            <h3 className="ca-group-label">{t("connectApps.ways")}</h3>
            <div className="ca-card">
              {ways.map((way) => (
                <div key={way.key} className="ca-card-row" data-way={way.key}>
                  <span>{way.label}</span>
                  {way.connected ? <ConnectedMark /> : way.action && <RowPill action={way.action} name={`${entry.label}, ${way.label}`} />}
                </div>
              ))}
            </div>
          </div>
        )}
        {model.remote && !ways && <p className="ca-notice">{t(model.remote.open ? "connectApps.remote.open" : "connectApps.remote.note", { name: entry.label })}</p>}
        {viaSteps && !gmail && <ComposioKeyStep slug={slug} name={entry.label} connectors={connectors} />}
        {composio && (accounts.length > 0 || askingAlias) && (
          <div data-accounts="">
            <h3 className="ca-group-label">{t("connectApps.accounts")}</h3>
            <div className="ca-card">
              {accounts.map((account) => (
                <AccountRow key={account.id} account={account} service={entry.label} busy={phase?.kind === "connecting"}
                  onReconnect={() => void connectors.connect(slug, account.alias, account)}
                  onDisconnect={() => connectors.disconnect(slug, account.id)} />
              ))}
              {askingAlias && (
                <form className="ca-alias" onSubmit={(event) => {
                  event.preventDefault();
                  const name = alias.trim();
                  if (!name) { connectors.setError({ key: "connectors.aliasRequired" }); return; }
                  void connectors.connect(slug, name);
                }}>
                  <input autoFocus value={alias} maxLength={64} onChange={(event) => setAlias(event.target.value)}
                    placeholder={t("connectors.aliasPlaceholder")}
                    aria-label={accounts.length ? t("connectors.aliasAriaAnother", { service: entry.label }) : t("connectors.aliasAriaNew", { service: entry.label })} />
                  <button type="submit" className="ca-primary" disabled={phase?.kind === "connecting" || !alias.trim()}><span>{t("connectors.action.continue")}</span></button>
                </form>
              )}
              {aliasError && <p role="alert" className="ca-card-row">{aliasError}</p>}
              {!askingAlias && accounts.length > 0 && (
                <div className="ca-card-row">
                  <button type="button" className="ca-pill" disabled={phase?.kind === "connecting"}
                    onClick={() => { setAlias(""); connectors.askAlias(slug); }}>
                    <span>{t("connectors.action.addAccount")}</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
        {model.toolkit && !gmail && <ToolkitAbilities toolkit={model.toolkit} />}
        {!ownCard && <AppFacts facts={facts} />}
      </div>
    </div>
  );
}

/** One account, Grok's way: its name, a mark when it needs signing in again, and Disconnect that turns into Confirm
 * Disconnect in place instead of asking in a dialog. */
function AccountRow({ account, service, busy, onReconnect, onDisconnect }: {
  account: ConnectorAccount;
  service: string;
  busy: boolean;
  onReconnect: () => void;
  onDisconnect: () => Promise<boolean>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [failed, setFailed] = useState(false);
  const [removing, setRemoving] = useState(false);
  const title = account.alias || t("connectApps.account.fallback");
  const stale = needsReconnect(account);
  return (
    <>
      <div className="ca-card-row" data-account={account.id}>
        <span data-glyph="" aria-hidden="true"><GrokIcon name="person" size={16} /></span>
        <span title={account.alias ? undefined : account.id}>
          {title}
          {stale && <span className="ca-account-tag">{t("connectApps.account.needsReconnect")}</span>}
        </span>
        {stale && (
          <button type="button" className="ca-pill" disabled={busy || removing}
            aria-label={t("connectors.reconnectAria", { account: title, service })} onClick={onReconnect}>
            <span>{t("connectors.action.reconnect")}</span>
          </button>
        )}
        {confirming ? (
          <button type="button" className="ca-pill" data-tone="danger-solid" disabled={busy || removing}
            aria-label={t("connectApps.account.confirmAria", { title })}
            onClick={() => {
              setConfirming(false);
              setFailed(false);
              setRemoving(true);
              void onDisconnect().then((ok) => { setRemoving(false); if (!ok) setFailed(true); });
            }}>
            <span>{t("connectApps.account.confirm")}</span>
          </button>
        ) : (
          <button type="button" className="ca-pill" data-tone="danger" disabled={busy || removing}
            aria-label={t("connectors.disconnectAria", { account: title, service })} onClick={() => setConfirming(true)}>
            <span>{t("connectors.disconnect")}</span>
          </button>
        )}
      </div>
      {failed && <p role="alert" className="ca-card-row">{t("connectApps.account.removeFailed")}</p>}
    </>
  );
}

const AUTH_LABEL: Record<string, LocaleKey> = {
  OAUTH2: "connectApps.auth.account", OAUTH1: "connectApps.auth.account", DCR_OAUTH: "connectApps.auth.account", S2S_OAUTH2: "connectApps.auth.account",
  API_KEY: "connectApps.auth.key", BEARER_TOKEN: "connectApps.auth.token", BASIC: "connectApps.auth.password", BASIC_WITH_JWT: "connectApps.auth.password",
  NO_AUTH: "connectApps.auth.none",
};

/** How you sign in to a Composio app, in words: "Your account, API key". */
export function signInLabel(schemes: readonly string[] | undefined): string | null {
  const labels = [...new Set((schemes ?? []).flatMap((scheme) => AUTH_LABEL[scheme] ? [t(AUTH_LABEL[scheme])] : []))];
  return labels.length ? labels.join(", ") : null;
}

export function appFacts(model: Pick<AppPageModel, "entry" | "categoryLabel" | "usedBy" | "toolkit">): Array<[string, string]> {
  const facts: Array<[string, string]> = [];
  if (model.categoryLabel) facts.push([t("connectApps.info.category"), model.categoryLabel]);
  const signIn = signInLabel(model.toolkit?.auth);
  if (signIn) facts.push([t("connectApps.info.signIn"), signIn]);
  if (model.entry.website) facts.push([t("connectApps.info.website"), model.entry.website]);
  if (model.usedBy.length) facts.push([t("connectApps.info.usedBy"), model.usedBy.join(", ")]);
  return facts;
}

const SHOWN = 8;

/** What an app can do: its first actions and triggers by name, then a link to every one on Composio's page for it. */
function ToolkitAbilities({ toolkit }: { toolkit: SnapshotToolkit }) {
  // undefined while its names load, so the card opens whole instead of growing
  const [lists, setLists] = useState<ToolkitActions | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    setLists(undefined);
    void loadToolkitActions(toolkit.slug).then((found) => { if (alive) setLists(found); });
    return () => { alive = false; };
  }, [toolkit.slug]);
  const groups: Array<{ key: string; label: string; names: string[]; total: number }> = [
    { key: "actions", label: t("connectApps.canDo"), names: lists?.actions ?? [], total: toolkit.tools },
    { key: "triggers", label: t("connectApps.info.triggers"), names: lists?.triggers ?? [], total: toolkit.triggers ?? 0 },
  ];
  if (lists === undefined) return null;
  return groups.filter((group) => group.total > 0).map((group) => (
    <div key={group.key} data-toolkit-group={group.key}>
      <h3 className="ca-group-label">{group.label}<span>{group.total}</span></h3>
      <div className="ca-card">
        {group.names.slice(0, SHOWN).map((name, index) => (
          <div key={`${index}:${name}`} className="ca-card-row"><span>{name}</span></div>
        ))}
        {group.total > Math.min(SHOWN, group.names.length) && (
          <div className="ca-card-row">
            <a className="ca-link" href={composioPage(toolkit.slug)} target="_blank" rel="noopener noreferrer">
              {t("connectApps.composioAll", { count: group.total })}
            </a>
          </div>
        )}
      </div>
    </div>
  ));
}

/** Grok's Information card: a label, then a bordered list of facts with their values at the end. */
export function AppFacts({ facts }: { facts: Array<[string, string]> }) {
  if (!facts.length) return null;
  return (
    <div>
      <h3 className="ca-group-label">{t("connectApps.information")}</h3>
      <dl className="ca-card">
        {facts.map(([term, value]) => (
          <div key={term} className="ca-card-row">
            <dt>{term}</dt>
            <dd title={value}>{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
