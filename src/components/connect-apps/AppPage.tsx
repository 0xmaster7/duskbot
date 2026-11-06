import { useEffect, useState } from "react";

import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { needsReconnect } from "@/lib/connector-status";
import { askConfirm } from "../ConfirmDialog";
import { connectorSetupNotice, disconnectAccountConfirmation } from "../PluginsPanel";
import type { ToolkitCard } from "../ServiceIcon";
import { GrokIcon } from "../GrokIcon";
import { AppTile } from "./AppRow";
import type { AppEntry, Connection } from "./catalog";
import type { ConnectorPhase, Connectors } from "./use-connectors";
import { composioPage, loadToolkitActions, type SnapshotToolkit, type ToolkitActions } from "./composio-snapshot";

export interface AppPageModel {
  entry: AppEntry;
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
  remote?: { open: boolean; busy: boolean; onConnect: () => void; onManage: () => void };
}

interface Primary { label: string; busy?: boolean; disabled?: boolean; quiet?: boolean; onClick?: () => void }

function PrimaryButton({ primary }: { primary: Primary }) {
  const labels = [primary.label, t("connectApps.connecting")];
  const shown = primary.busy ? labels[1] : labels[0];
  return (
    <button type="button" className="ca-primary" data-tone={primary.quiet ? "quiet" : undefined} disabled={primary.busy || primary.disabled}
      aria-busy={primary.busy || undefined} onClick={primary.onClick}>
      {labels.map((label) => <span key={label} aria-hidden={label === shown ? undefined : true}>{label}</span>)}
    </button>
  );
}

/** One app's page: its tile, name and main action, what it does, its accounts, and the facts about it. */
export function AppPage({ model }: { model: AppPageModel }) {
  const { entry, phase, card, connectors } = model;
  const [alias, setAlias] = useState("");
  const slug = entry.id;
  const composio = entry.kind === "composio" && card !== undefined;
  const status = composio ? connectors.status[slug] : undefined;
  const accounts = status?.accounts ?? [];
  const setup = composio ? connectorSetupNotice({ configured: connectors.configured, stale: connectors.stale, setup: connectors.setup, remoteClient: model.remoteClient }) : null;
  const askingAlias = composio && connectors.aliasFor === slug;
  const aliasError = askingAlias && connectors.error ? (typeof connectors.error === "string" ? connectors.error : t(connectors.error.key)) : null;

  const primary = ((): Primary | null => {
    if (model.remote) {
      return model.connection === "connected"
        ? { label: t("connectApps.remote.manage"), quiet: true, onClick: model.remote.onManage }
        : { label: t("connectors.action.connect"), busy: model.remote.busy, disabled: model.connection === "unknown", onClick: model.remote.onConnect };
    }
    if (!composio || !phase) return null;
    const connect: Primary = { label: t("connectors.action.connect"), onClick: () => void connectors.connect(slug) };
    if (!connectors.configured) return { ...connect, disabled: model.remoteClient, onClick: model.onOpenKeys };
    switch (phase.kind) {
      case "checking": return { ...connect, disabled: true };
      case "connecting": return { ...connect, busy: true };
      case "continue": return { label: t("connectors.action.continue"), onClick: () => connectors.resume(slug) };
      case "reconnect": return { label: t("connectors.action.reconnect"), onClick: () => void connectors.connect(slug, phase.account.alias, phase.account) };
      case "connected": return { label: t("connectors.action.addAccount"), quiet: true, onClick: () => { setAlias(""); connectors.askAlias(slug); } };
      case "included": return { label: t("connectors.action.included"), quiet: true, disabled: true };
      case "unavailable": return { ...connect, disabled: true };
      default: return connect;
    }
  })();

  const facts = appFacts(model);
  const ownCard = entry.kind !== "composio";

  return (
    <div className="ca-detail" data-app-page={slug}>
      <div className="ca-detail-top">
        <header className="ca-detail-header">
          <AppTile entry={entry} size={56} />
          <h3 className="ca-detail-name" data-detail-hero-title="">{entry.label}</h3>
          {primary && <PrimaryButton primary={primary} />}
        </header>
        <p className="ca-detail-desc">{entry.description}</p>
      </div>
      <div className="ca-groups">
        {setup && (
          <p className="ca-notice" data-tone={setup.tone === "warning" ? "danger" : undefined}>
            {t(setup.key)}{" "}
            {!model.remoteClient && <button type="button" className="ca-link" onClick={model.onOpenKeys}>{t("connectors.openSettings")}</button>}
          </p>
        )}
        {phase?.kind === "unavailable" && <p className="ca-notice">{phase.reason}</p>}
        {model.remote && <p className="ca-notice">{t(model.remote.open ? "connectApps.remote.open" : "connectApps.remote.note", { name: entry.label })}</p>}
        {composio && (accounts.length > 0 || askingAlias) && (
          <div>
            <h3 className="ca-group-label">{t("connectApps.accounts")}{accounts.length > 0 && <span>{accounts.length}</span>}</h3>
            <div className="ca-card">
              {accounts.map((account) => (
                <div key={account.id} className="ca-card-row">
                  <span data-glyph="" aria-hidden="true"><GrokIcon name="person" size={16} /></span>
                  <span>
                    {account.alias || account.id}
                    <small>{account.status.toLowerCase()}</small>
                  </span>
                  {needsReconnect(account) && (
                    <button type="button" className="ca-link" disabled={phase?.kind === "connecting"}
                      aria-label={t("connectors.reconnectAria", { account: account.alias || account.id, service: entry.label })}
                      onClick={() => void connectors.connect(slug, account.alias, account)}>
                      {t("connectors.action.reconnect")}
                    </button>
                  )}
                  <button type="button" className="ca-link" data-tone="danger" disabled={phase?.kind === "connecting"}
                    aria-label={t("connectors.disconnectAria", { account: account.alias || account.id, service: entry.label })}
                    onClick={() => void askConfirm(disconnectAccountConfirmation(entry.label, account)).then((yes) => { if (yes) connectors.disconnect(slug, account.id); })}>
                    {t("connectors.disconnect")}
                  </button>
                </div>
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
              {aliasError && <p role="alert" className="ca-card-row text-danger">{aliasError}</p>}
            </div>
          </div>
        )}
        {model.toolkit && <ToolkitAbilities toolkit={model.toolkit} />}
        {!ownCard && <AppFacts facts={facts} />}
      </div>
    </div>
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
