// The AIs people already use, as a grid of cards with their own logos. A press opens that provider's own sign-in in the
// browser (SignInPill's flows), or its setup under the grid where it has no sign-in (EngineSetup: an API key, an install,
// a local endpoint). A connected AI turns green with a check and can't be pressed again; the window comes back to the
// front when a sign-in finishes. The first run, the Connect an AI dialog and Settings > Models all show this one grid.
import { useEffect, useRef, useState } from "react";
import { Check, Server } from "../../icons";
import { EngineSetup } from "@/components/EngineSetup";
import { engineReady } from "@/components/EngineLibrary";
import { CursorMark, PresetProviderMark, ProviderMark } from "@/components/ProviderIcons";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { plainSignIn } from "@/lib/onboarding";
import { useStore, type InstanceInfo } from "@/state/store";
import { aiName, aiTiles, type AiTile, type AiTileId } from "./funnel";
import { TILE } from "./FunnelSteps";
import { SignInPill, pillWay, useSignInPill } from "./SignInPill";
import type { WelcomeAiNow } from "./welcome-ai";

const ready = (instance: InstanceInfo) => engineReady(instance);

function TileMark({ tile, size }: { tile: AiTile<InstanceInfo>; size: number }) {
  switch (tile.id) {
    case "chatgpt": return <ProviderMark driverKind="codex" size={size} />;
    case "claude": return <ProviderMark driverKind="claudeAgent" size={size} />;
    case "grok": return <ProviderMark driverKind="grokAgent" size={size} />;
    case "gemini": return <PresetProviderMark preset="google" size={size} />;
    case "cursor": return <CursorMark size={size} />;
    case "copilot": return <ProviderMark driverKind="copilotAgent" size={size} />;
    case "openrouter": return <PresetProviderMark preset="openrouter" size={size} />;
    case "local": return <Server size={size - 4} strokeWidth={1.5} className="text-ink-secondary" />;
  }
}

const label = (tile: AiTile<InstanceInfo>) => (tile.id === "local" ? t("funnel.ai.local") : tile.label);

/** A local endpoint or a step finished in Terminal keeps its own words; a website sign-in says the plain line. */
export function setupFor(instance: InstanceInfo) {
  if (instance.access === "custom") return { intent: "inject" as const };
  return plainSignIn(instance)
    ? { intent: "cloud" as const, description: t("onboarding.engines.signInHint", { name: instance.displayName }) }
    : { intent: "cloud" as const };
}

/** The pressed AI's way in. A website sign-in or an install starts on the press itself; what is left here is the wait,
 * the code to paste back or to enter, or the setup for an AI without a sign-in. */
function Connect({ instance, testing, onMore }: { instance: InstanceInfo; testing: boolean; onMore?: () => void }) {
  const pill = useSignInPill(instance);
  const way = pillWay(instance);
  const begin = useRef(pill);
  begin.current = pill;
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (way === "install") void begin.current.install();
    else if (way === "sign-in") void begin.current.start();
  }, [way]);
  if (way !== "dialog") {
    return (
      <div className="flex flex-col items-center gap-2.5">
        <SignInPill pill={pill} instance={{ ...instance, displayName: aiName(instance) }} waiting={testing} onDialog={() => onMore?.()} />
        {pill.error && <p role="alert" className="text-[13px] leading-[18px] text-danger">{pill.error}</p>}
      </div>
    );
  }
  return <EngineSetup instance={instance} {...setupFor(instance)} className="w-full max-w-[440px] rounded-2xl border-0 bg-ink/[0.035] p-4 text-start" />;
}

function AiCard({ tile, connected, picked, onPick }: { tile: AiTile<InstanceInfo>; connected: boolean; picked: boolean; onPick: () => void }) {
  if (connected) {
    return (
      <div data-funnel-ai={tile.id} data-connected="" role="listitem" aria-label={t("funnel.ai.connectedName", { name: label(tile) })}
        className="ai-connected place-reveal relative flex h-[96px] flex-col items-center justify-center gap-1.5 rounded-2xl bg-success/[0.09] px-2">
        <span className="grid size-7 place-items-center"><TileMark tile={tile} size={26} /></span>
        <span className="flex max-w-full flex-col items-center">
          <span className="max-w-full truncate text-[13px] leading-[18px] text-ink">{label(tile)}</span>
          <span className="flex items-center gap-1 text-[12px] leading-4 text-success">
            <Check size={12} strokeWidth={2.5} aria-hidden="true" className="shrink-0" />{t("funnel.ai.ready")}
          </span>
        </span>
      </div>
    );
  }
  return (
    <div role="listitem" className="flex">
      <button type="button" data-funnel-ai={tile.id} aria-pressed={picked} onClick={onPick}
        className={cn(TILE, "relative flex h-[96px] w-full flex-col items-center justify-center gap-2 px-2", picked && "bg-ink/[0.08] hover:bg-ink/[0.08]")}>
        <span className="grid size-7 place-items-center"><TileMark tile={tile} size={26} /></span>
        <span className="max-w-full truncate text-[13px] leading-[18px] text-ink">{label(tile)}</span>
      </button>
    </div>
  );
}

/** Brings the app back to the front when an AI becomes connected while the grid is open (a sign-in in the browser). */
function useFocusOnConnect(connectedIds: readonly string[]) {
  const seen = useRef<Set<string> | null>(null);
  const key = connectedIds.join(",");
  useEffect(() => {
    const now = new Set(key ? key.split(",") : []);
    const before = seen.current;
    seen.current = now;
    if (before && [...now].some((id) => !before.has(id))) void window.duskDesktop?.focusWindow?.().catch(() => {});
  }, [key]);
}

/** The AIs that are connected here now, by their card. */
export function connectedAiCards(instances: readonly InstanceInfo[]): AiTileId[] {
  return aiTiles(instances, ready).filter((tile) => ready(tile.instance)).map((tile) => tile.id);
}

/** The grid of popular AIs and, under it, the pressed one's way in. `onMore`: the small link to every other provider and
 * API keys (the model directory). */
export function AiCards({ tested, onMore, className }: { tested: WelcomeAiNow | null; onMore?: () => void; className?: string }) {
  const { state } = useStore();
  const [picked, setPicked] = useState<AiTileId | null>(null);
  const tiles = aiTiles(state.instances, ready);
  const chosen = tiles.find((tile) => tile.id === picked && !ready(tile.instance));
  useFocusOnConnect(tiles.filter((tile) => ready(tile.instance)).map((tile) => tile.id));

  return (
    <div data-ai-cards="" className={cn("@container flex w-full flex-col items-center", className)}>
      <div role="list" aria-label={t("funnel.ai.title")} className="grid w-full grid-cols-2 gap-2.5 @min-[400px]:grid-cols-4">
        {tiles.map((tile) => (
          <AiCard key={tile.id} tile={tile} connected={ready(tile.instance)} picked={picked === tile.id}
            onPick={() => setPicked(picked === tile.id ? null : tile.id)} />
        ))}
      </div>
      {chosen && (
        <div key={chosen.id} data-funnel-ai-connect={chosen.id} className="place-reveal mt-5 flex w-full flex-col items-center">
          <Connect instance={chosen.instance} onMore={onMore}
            testing={tested?.state === "testing" && tested.instance.instanceId === chosen.instance.instanceId} />
        </div>
      )}
      {onMore && (
        <button type="button" data-ai-more="" onClick={onMore}
          className="mt-3 min-h-9 rounded-full px-3 text-[13px] leading-[18px] text-ink-secondary transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus motion-reduce:transition-none">
          {t("connectAi.more")}
        </button>
      )}
    </div>
  );
}
