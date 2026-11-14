import { useEffect, useRef, useState } from "react";
import { Loader2, Plus } from "../../icons";
import type { InstanceInfo } from "@/state/store";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { fetchProviders, useModelSearch, type ProvidersAnswer } from "@/lib/model-providers";
import { MENU_GUTTER, MENU_ICON, MENU_LABEL, MENU_LINE, MENU_SEPARATOR, MENU_STROKE, SIMPLE_MENU_META, SIMPLE_MENU_ROW } from "../menu-recipe";
import { ConnectProviderDialog } from "./ConnectProviderDialog";
import { ModelBadges } from "./ModelBadges";

const SHOWN_GROUPS = 4;
const SHOWN_MODELS = 3;

/** In the model picker, under the connected AIs: the same search over providers not connected here yet. Picking one
 * opens the sheet that connects its provider. */
export function CatalogMatches({ query, onConnect }: { query: string; onConnect: (providerId: string, model: string) => void }) {
  const hits = useModelSearch(query);
  if (!query.trim()) return null;
  if (hits === null) {
    return (
      <div role="status" className={cn(MENU_LINE, "text-ink-tertiary")}>
        <span className={MENU_GUTTER}><Loader2 size={14} className="animate-spin" aria-hidden="true" /></span>
        <span className="min-w-0 flex-1 truncate">{t("models.picker.searching")}</span>
      </div>
    );
  }
  const others = hits.filter((hit) => !hit.group.connected).slice(0, SHOWN_GROUPS);
  if (!others.length) return null;
  return (
    <div data-catalog-matches className="mt-1 flex flex-col gap-0.5">
      <div role="separator" className={MENU_SEPARATOR} />
      <div className={MENU_LABEL}>{t("models.picker.other")}</div>
      {others.flatMap((hit) => hit.models.slice(0, SHOWN_MODELS).map((model) => (
        <button key={`${hit.group.providerId}:${model.id}`} type="button" data-menu-row data-catalog-match={hit.group.providerId} tabIndex={-1}
          title={t("models.picker.connectTo", { name: hit.group.label })} onClick={() => onConnect(hit.group.providerId, model.id)} className={SIMPLE_MENU_ROW}>
          <span className={MENU_GUTTER}><Plus size={16} strokeWidth={MENU_STROKE} className={MENU_ICON} aria-hidden="true" /></span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate">{model.name}</span>
            <span className={cn(SIMPLE_MENU_META, "flex min-w-0 items-center gap-1.5")}>
              <span className="shrink-0">{hit.group.label}</span>
              <ModelBadges model={model} className="flex-nowrap overflow-hidden" />
            </span>
          </span>
        </button>
      )))}
    </div>
  );
}

/** The connect sheet for a provider picked by id, once this server has said what it can connect. */
export function ConnectById({ providerId, model, onClose, onConnected }: {
  providerId: string;
  model?: string;
  onClose: () => void;
  onConnected?: (instanceId: string, instances: InstanceInfo[]) => void;
}) {
  const [answer, setAnswer] = useState<ProvidersAnswer | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    let live = true;
    fetchProviders().then((next) => { if (live) setAnswer(next); }, () => { if (live) closeRef.current(); });
    return () => { live = false; };
  }, []);
  if (!answer) return null;
  const known = answer.providers.find((provider) => provider.id === providerId);
  const more = answer.more.find((entry) => entry.id === providerId);
  const provider = known ?? (more ? { id: more.id, label: more.label, section: "more" as const, wire: "openai" as const, baseUrl: "", listModels: "openai" as const,
    offered: true, modelCount: more.modelCount, connected: [] } : undefined);
  if (!provider) return null;
  return <ConnectProviderDialog provider={provider} place={answer.place} model={model} onClose={onClose} onConnected={onConnected} />;
}
