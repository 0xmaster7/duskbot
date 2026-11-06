import { useState } from "react";

import { xResearchAction } from "@/lib/cloud-plan";
import { HIGHLEVEL_SLUG } from "@/lib/highlevel-sign-in";
import { t } from "@/lib/i18n";
import { mcpServersForBot, mcpServersOfBot, useMcpServers } from "@/lib/mcp-servers";
import { useStore, type Bot } from "@/state/store";
import type { ConnectorScope } from "../../../../shared/connector-scopes";
import { ConnectorToolsGrants } from "../../bot-settings/AccessSection";
import { useToolSelection } from "../../bot-settings/ToolSelectionCard";
import { useBotApps } from "../../bot-settings/useBotApps";
import type { useBotSettingsDerived } from "../../bot-settings/useBotSettingsDerived";
import { openKeySettings } from "../../keys/key-focus";
import { useCloudPlan } from "../../ProIntroduction";
import { Switch } from "../../SettingsPrimitives";
import { textAreaCls } from "../../ui/GrokDialog";
import { SelectPill } from "../../ui/SelectPill";
import { Choices, FieldRow, Group, LinkRow, Pill, Row } from "./sheet-kit";

type Derived = ReturnType<typeof useBotSettingsDerived>;

/** The bot's apps, MCP servers, tool selection, web research and always-allowed tools, as rows. */
export function ToolsSheet({ bot, derived }: { bot: Bot; derived: Derived }) {
  return (
    <>
      <AppsGroup bot={bot} derived={derived} />
      <ServersGroup bot={bot} patch={derived.patch} />
      <SelectionGroup bot={bot} engineKind={derived.engine?.driverKind} />
      <ResearchGroup bot={bot} patch={derived.patch} />
      <AlwaysGroup bot={bot} patch={derived.patch} />
    </>
  );
}

function AppsGroup({ bot, derived }: { bot: Bot; derived: Derived }) {
  const { dispatch } = useStore();
  const { patch, canUseConnectedApps, connectedAppsConfigured, connectedAppsEnabled, connectorGrantState } = derived;
  const apps = useBotApps(bot);
  const [grantsOpen, setGrantsOpen] = useState(false);
  const scopes = bot.connectorScopes;
  const limited = scopes !== undefined;
  const slugs = [...new Set([...apps.connectedSlugs, ...Object.keys(scopes?.apps ?? {})])].sort();
  const labels = Object.fromEntries(apps.apps.map((app) => [app.slug, app.label]));
  const grantSlugs = apps.connectedSlugs.filter((slug) => slug !== HIGHLEVEL_SLUG);
  const shown = connectedAppsEnabled && apps.phase === "ready";
  const hint = !connectedAppsConfigured ? t("botPanel.sheet.appsConnectFirst")
    : !canUseConnectedApps ? t("botPanel.sheet.appsNoModel")
      : !connectedAppsEnabled ? t("botPanel.sheet.off")
        : connectorGrantState === "partial" ? t("botPanel.sheet.appsSome")
          : connectorGrantState === "none" ? t("botPanel.sheet.appsNoTools") : t("botPanel.sheet.on");
  const setScope = (slug: string, scope: ConnectorScope | null) => {
    const next = { ...scopes?.apps };
    if (scope) next[slug] = scope;
    else delete next[slug];
    patch({ connectorScopes: { apps: next } });
  };

  return (
    <Group label={t("botPanel.sheet.apps")} data-sheet-group="apps">
      <Row title={t("botPanel.sheet.appsRow")} hint={hint}>
        <Switch
          checked={connectedAppsEnabled}
          aria-label={t("botAccess.apps.allow")}
          disabled={!connectedAppsEnabled && (!connectedAppsConfigured || !canUseConnectedApps)}
          onClick={() => patch({ composio: !connectedAppsEnabled })}
        />
      </Row>
      {shown && (
        <Row title={t("botPanel.sheet.onlyChosen")}>
          <Switch checked={limited} aria-label={t("botAccess.scopes.limitLabel")} onClick={() => patch({ connectorScopes: limited ? null : { apps: {} } })} />
        </Row>
      )}
      {shown && limited && slugs.map((slug) => (
        <Row key={slug} title={labels[slug] ?? slug} hint={apps.connectedSlugs.includes(slug) ? undefined : t("botAccess.scopes.notConnected")}>
          <Choices
            label={t("botAccess.scopes.accessLabel", { app: labels[slug] ?? slug })}
            value={scopes?.apps[slug] ?? null}
            onChange={(scope) => setScope(slug, scope)}
            options={[
              [null, t("botAccess.scopes.off"), t("botAccess.scopes.offHint")],
              ["read", t("botAccess.scopes.read"), t("botAccess.scopes.readHint")],
              ["write", t("botAccess.scopes.readWrite"), t("botAccess.scopes.readWriteHint")],
            ]}
          />
        </Row>
      ))}
      {shown && grantSlugs.length > 0 && (
        <LinkRow data-sheet-row="grants" title={t("botAccess.grants.header")} open={grantsOpen} onClick={() => setGrantsOpen((open) => !open)} />
      )}
      {shown && grantsOpen && (
        <div className="-mt-3 px-3.5 pb-2.5">
          <ConnectorToolsGrants bot={bot} patch={patch} slugs={grantSlugs} />
        </div>
      )}
      {connectedAppsConfigured && (
        <LinkRow data-sheet-row="add-app" title={t("botPanel.sheet.addApp")} onClick={() => dispatch({ type: "togglePlugins", open: true, surface: "apps" })} />
      )}
    </Group>
  );
}

function ServersGroup({ bot, patch }: { bot: Bot; patch: Derived["patch"] }) {
  const { dispatch } = useStore();
  const { servers: all, error, refresh } = useMcpServers();
  const servers = all ? mcpServersOfBot(all, bot.id) : null;
  const mounted = new Set((servers ? mcpServersForBot(servers, bot.mcpServers, bot.id) : []).map((server) => server.name));
  const usesAll = bot.mcpServers == null;
  const busy = Boolean(bot.busy);
  const toggle = (name: string) => {
    if (!servers || busy || error) return;
    const current = usesAll ? servers.filter((server) => server.enabled).map((server) => server.name) : [...(bot.mcpServers ?? [])];
    patch({ mcpServers: current.includes(name) ? current.filter((item) => item !== name) : [...current, name] });
  };
  const add = (
    <Pill aria-label={t("botAccess.mcpAdd")} onClick={() => dispatch({ type: "togglePlugins", open: true, surface: "mcp" })}>
      {t("botPanel.sheet.add")}
    </Pill>
  );

  return (
    <Group label={t("connectors.tab.mcp")} footnote={busy ? t("botPanel.sheet.busy") : undefined} data-sheet-group="mcp">
      {error && <Row title={t("botPanel.sheet.serversError")} tone="warn"><Pill onClick={() => void refresh()}>{t("connectors.action.retry")}</Pill></Row>}
      {servers === null ? !error && <Row title={t("mcp.loading")} />
        : servers.length === 0 ? <Row title={t("botPanel.sheet.noServers")}>{add}</Row>
          : (
            <>
              {servers.map((server) => (
                <Row
                  key={server.name}
                  title={server.name}
                  hint={!server.enabled ? t("botPanel.sheet.serverOff") : server.offFor?.includes(bot.id) ? t("botPanel.sheet.serverOffHere") : undefined}
                >
                  <Switch
                    checked={mounted.has(server.name)}
                    disabled={!server.enabled || busy || Boolean(error)}
                    aria-label={t("botAccess.mcpAllow", { name: server.name })}
                    onClick={() => toggle(server.name)}
                  />
                </Row>
              ))}
              <Row title={t("botPanel.sheet.addServer")}>
                {!usesAll && <Pill disabled={busy || Boolean(error)} onClick={() => patch({ mcpServers: null })}>{t("botPanel.sheet.useAll")}</Pill>}
                {add}
              </Row>
            </>
          )}
    </Group>
  );
}

function SelectionGroup({ bot, engineKind }: { bot: Bot; engineKind?: string }) {
  const { saved, draft, fields, parsed, support, unavailable, saving, error, change, save, clear, example, status, empty } = useToolSelection(bot, engineKind);
  const busy = Boolean(bot.busy);
  const locked = saving || busy;

  return (
    <Group label={t("botAccess.tools.title")} footnote={busy ? t("botAccess.tools.busy") : undefined} data-sheet-group="tools">
      <Row title={t("botPanel.sheet.toolsRow")} hint={saving ? t("botAccess.tools.saving") : status} tone={saved.ok ? undefined : "danger"}>
        <SelectPill
          aria-label={t("botAccess.tools.title")}
          disabled={locked}
          value={fields.custom ? "custom" : "all"}
          options={[{ value: "all", label: t("botPanel.sheet.toolsAll") }, { value: "custom", label: t("botPanel.sheet.toolsCustom") }]}
          onChange={(value) => (value === "all" ? void clear() : change({ custom: true, onlyListed: true }))}
        />
      </Row>
      {fields.custom && (
        <>
          <Row title={t("botAccess.tools.onlyListed")}>
            <Switch checked={fields.onlyListed} disabled={locked} aria-label={t("botAccess.tools.onlyListed")} onClick={() => change({ onlyListed: !fields.onlyListed })} />
          </Row>
          <FieldRow label={t("botAccess.tools.allow")}>
            <textarea
              aria-label={t("botAccess.tools.allow")}
              disabled={locked || !fields.onlyListed}
              rows={3}
              spellCheck={false}
              placeholder={example}
              value={fields.allow}
              onChange={(event) => change({ allow: event.target.value })}
              className={`${textAreaCls} font-mono text-[12px]`}
            />
          </FieldRow>
          <FieldRow label={t("botAccess.tools.exclude")}>
            <textarea
              aria-label={t("botAccess.tools.exclude")}
              disabled={locked}
              rows={2}
              spellCheck={false}
              placeholder="mcp:mail:send"
              value={fields.deny}
              onChange={(event) => change({ deny: event.target.value })}
              className={`${textAreaCls} font-mono text-[12px]`}
            />
          </FieldRow>
          <Row title={t("botPanel.sheet.toolsSyntax")}>
            <Pill aria-label={t("botAccess.tools.save")} disabled={locked || !draft || !parsed.ok} onClick={() => void save()}>
              {t("botPanel.sheet.save")}
            </Pill>
          </Row>
          {empty && <Row title={t("botAccess.tools.emptyHint")} tone="warn" />}
          {unavailable && <Row title={t(support === "mcp" ? "botAccess.tools.nativeUnsupported" : "botAccess.tools.unsupported")} tone="danger" />}
          {!parsed.ok && <Row title={parsed.error} tone="danger" />}
        </>
      )}
      {error && <Row title={error} tone="danger" />}
    </Group>
  );
}

function ResearchGroup({ bot, patch }: { bot: Bot; patch: Derived["patch"] }) {
  const { state, dispatch } = useStore();
  const connecting = xResearchAction(useCloudPlan()?.view ?? null) === "connecting" && state.config?.xResearch?.unavailable !== true;
  const available = state.config?.treg?.configured === true || state.config?.xResearch?.included === true;
  const on = bot.xResearch !== false;
  const hint = !available ? t(connecting ? "botPanel.sheet.researchSetup" : "botPanel.sheet.researchKey") : t(on ? "botPanel.sheet.on" : "botPanel.sheet.off");
  return (
    <Group label={t("botPanel.sheet.research")} data-sheet-group="research">
      <Row title={t("botPanel.sheet.researchRow")} hint={hint}>
        {!available && !connecting
          ? <Pill onClick={() => dispatch(openKeySettings("treg"))}>{t("botPanel.sheet.addKey")}</Pill>
          : <Switch checked={available && on} disabled={!available} aria-label={t("research.switch")} onClick={() => patch({ xResearch: !on })} />}
      </Row>
    </Group>
  );
}

function AlwaysGroup({ bot, patch }: { bot: Bot; patch: Derived["patch"] }) {
  const entries = bot.alwaysAllow ?? [];
  return (
    <Group label={t("botAccess.always.title")} data-sheet-group="always">
      {entries.length === 0 && <Row title={t("botPanel.sheet.nothingYet")} />}
      {entries.map((entry) => (
        <Row key={entry} title={entry} mono>
          <Pill aria-label={t("botAccess.always.remove", { entry })} onClick={() => patch({ alwaysAllow: entries.filter((key) => key !== entry) })}>
            {t("botPanel.sheet.remove")}
          </Pill>
        </Row>
      ))}
    </Group>
  );
}
