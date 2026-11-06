import { useEffect, useState } from "react";

import { classifyConnectorTool, connectorServiceAccess, withServiceGrant, type ConnectorVerb } from "@/lib/connector-grants";
import { t } from "@/lib/i18n";
import type { Bot } from "@/state/store";
import { Card, CheckRow, NavRow, NoteRow, SwitchRow, useSubPage } from "../ListRows";
import { textFieldCls } from "../ui/GrokDialog";
import { preloadConnectorTools, VERB_LABELS, VERB_ORDER, type ToolListing } from "./AccessSection";
import type { useBotSettingsDerived } from "./useBotSettingsDerived";

type Patch = ReturnType<typeof useBotSettingsDerived>["patch"];

/** The prefix of a page that holds one app's tools, under the per-app tools page. */
export const GRANT_PAGE = "grant:";

function accessLabel(record: Bot["connectorTools"], slug: string): string {
  const access = connectorServiceAccess(record, slug);
  if (!access.editable) return t("botAccess.grants.custom");
  if (access.level === "all") return t("botAccess.grants.allTools");
  if (access.level === "none") return t("botAccess.grants.noTools");
  return t("botAccess.grants.toolCount", { count: access.count });
}

/** Per-app tools as rows: each connected app with what it may use, a row opening its tools on a page of their own. */
export function ConnectorGrantRows({ bot, patch, slugs }: { bot: Bot; patch: Patch; slugs: string[] }) {
  const { open } = useSubPage();
  const record = bot.connectorTools;
  if (!slugs.length) return <Card><NoteRow>{t("botAccess.grants.noApps")}</NoteRow></Card>;
  return (
    <>
      <Card footnote={t("botAccess.grants.hint")} data-sheet-group="grants">
        {slugs.map((slug) => (
          <NavRow key={slug} data-sheet-row={`grant:${slug}`} title={slug} value={accessLabel(record, slug)} onClick={() => open(`${GRANT_PAGE}${slug}`, slug)} />
        ))}
      </Card>
      {record !== undefined && record !== null && (
        <Card>
          <NavRow drill={false} data-sheet-row="grants-reset" title={t("botAccess.grants.allApps")} onClick={() => patch({ connectorTools: null })} />
        </Card>
      )}
    </>
  );
}

/** One app's tools: all of them with one switch, or each tool checked on its own, with a row per kind to add them all. */
export function ConnectorGrantPage({ bot, patch, slug, slugs }: { bot: Bot; patch: Patch; slug: string; slugs: string[] }) {
  const [tools, setTools] = useState<Record<string, ToolListing[]> | null>(null);
  const [toolsError, setToolsError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [lastExplicit, setLastExplicit] = useState<string[]>([]);

  useEffect(() => {
    if (tools || toolsError) return;
    let cancelled = false;
    preloadConnectorTools()
      .then((services) => { if (!cancelled) setTools(services); })
      .catch((error: unknown) => { if (!cancelled) setToolsError(error instanceof Error ? error.message : String(error)); });
    return () => { cancelled = true; };
  }, [tools, toolsError]);

  const record = bot.connectorTools;
  const access = connectorServiceAccess(record, slug);
  if (!access.editable) return <Card><NoteRow>{t("botAccess.grants.uneditable")}</NoteRow></Card>;
  const grant = record?.[slug];
  const isAll = access.level === "all" && record !== undefined && record !== null && grant?.tools === "*";
  const selected = grant && grant.tools !== "*" ? grant.tools : [];
  const apply = (next: { tools: "*" | string[] } | null) => {
    const value = withServiceGrant(record, slug, next, slugs);
    if (value !== undefined) patch({ connectorTools: value });
  };
  const choose = (next: string[]) => {
    if (!next.length) { apply(null); return; }
    setLastExplicit(next);
    apply({ tools: next });
  };
  const serviceTools = tools?.[slug] ?? [];
  const query = search.trim().toLowerCase();
  const matches = query
    ? serviceTools.filter((tool) => tool.name.toLowerCase().includes(query) || (tool.description ?? "").toLowerCase().includes(query))
    : serviceTools;
  const byKind = new Map<ConnectorVerb, string[]>();
  for (const tool of serviceTools) {
    const verb = classifyConnectorTool(tool.name);
    if (verb) byKind.set(verb, [...(byKind.get(verb) ?? []), tool.name]);
  }

  return (
    <>
      <Card data-sheet-group="grant">
        <SwitchRow
          data-sheet-row="grant-all"
          title={t("botAccess.grants.allTools")}
          checked={isAll}
          onChange={() => {
            if (isAll) { if (lastExplicit.length) apply({ tools: lastExplicit }); else apply(null); return; }
            if (selected.length) setLastExplicit(selected);
            apply({ tools: "*" });
          }}
        />
      </Card>
      {toolsError ? (
        <Card>
          <NoteRow tone="warn">{t("botAccess.grants.loadError")}</NoteRow>
          <NavRow drill={false} title={t("botAccess.grants.retry")} onClick={() => {
            setToolsError(null);
            setTools(null);
            void preloadConnectorTools(true).catch(() => undefined);
          }} />
        </Card>
      ) : tools === null ? (
        <Card><NoteRow>{t("botAccess.grants.loading")}</NoteRow></Card>
      ) : serviceTools.length === 0 ? (
        <Card><NoteRow>{t("botAccess.grants.noListing")}</NoteRow></Card>
      ) : (
        <>
          {!isAll && byKind.size > 0 && (
            <Card label={t("settings.s2.bots.byKind")} data-sheet-group="grant-kinds">
              {VERB_ORDER.filter((verb) => byKind.has(verb)).map((verb) => {
                const names = byKind.get(verb) ?? [];
                return <NavRow key={verb} drill={false} tooltip={t("botAccess.grants.verbHint")} title={t(VERB_LABELS[verb])} value={names.length} onClick={() => choose([...new Set([...selected, ...names])])} />;
              })}
            </Card>
          )}
          <Card label={t("settings.s2.bots.tools")} data-sheet-group="grant-tools">
            {serviceTools.length > 12 && (
              <div className="px-1 pb-1 pt-0.5">
                <input className={textFieldCls} placeholder={t("botAccess.grants.search")} aria-label={t("botAccess.grants.search")} value={search} onChange={(event) => setSearch(event.target.value)} />
              </div>
            )}
            {matches.map((tool) => (
              <CheckRow
                key={tool.name}
                data-sheet-row={`tool:${tool.name}`}
                title={tool.name}
                hint={tool.description}
                checked={isAll || selected.includes(tool.name)}
                disabled={isAll}
                onClick={() => choose(selected.includes(tool.name) ? selected.filter((name) => name !== tool.name) : [...selected, tool.name])}
              />
            ))}
            {matches.length === 0 && <NoteRow>{t("botAccess.grants.noMatches")}</NoteRow>}
          </Card>
        </>
      )}
    </>
  );
}
