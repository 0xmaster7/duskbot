import { useState } from "react";

import { t } from "@/lib/i18n";
import { needsReconnect } from "@/lib/connector-status";
import { askConfirm } from "../ConfirmDialog";
import { connectorSetupNotice, disconnectAccountConfirmation } from "../PluginsPanel";
import type { ToolkitCard } from "../ServiceIcon";
import { AppTile } from "./AppRow";
import type { AppEntry, Connection } from "./catalog";
import type { ConnectorPhase, Connectors } from "./use-connectors";

export interface AppPageModel {
  entry: AppEntry;
  connection: Connection;
  phase: ConnectorPhase | null;
  card: ToolkitCard | undefined;
  connectors: Connectors;
  categoryLabel: string | null;
  usedBy: string[];
  remoteClient: boolean;
  onOpenLogins: () => void;
  onOpenKeys: () => void;
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
        {composio && (accounts.length > 0 || askingAlias) && (
          <div>
            <h3 className="ca-group-label">{t("connectApps.accounts")}{accounts.length > 0 && <span>{accounts.length}</span>}</h3>
            <div className="ca-card">
              {accounts.map((account) => (
                <div key={account.id} className="ca-card-row">
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
        {!ownCard && <AppFacts facts={facts} />}
      </div>
    </div>
  );
}

export function appFacts(model: Pick<AppPageModel, "entry" | "categoryLabel" | "usedBy">): Array<[string, string]> {
  const facts: Array<[string, string]> = [];
  if (model.categoryLabel) facts.push([t("connectApps.info.category"), model.categoryLabel]);
  if (model.entry.website) facts.push([t("connectApps.info.website"), model.entry.website]);
  if (model.usedBy.length) facts.push([t("connectApps.info.usedBy"), model.usedBy.join(", ")]);
  return facts;
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
