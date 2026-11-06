// Settings → Import: everything that brings work in from elsewhere, in one place. "From your AI apps" brings the skills
// and MCP servers another AI tool keeps on this computer.
import { BookOpen, Plug } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { track } from "@/lib/analytics";
import { t } from "@/lib/i18n";
import { importOutcome, localSetupImport, setupImportApi, skillsSummary, toolsSummary, type SetupImportClient } from "@/lib/setup-import";
import { useStore } from "@/state/store";
import { detectionCount, detectionSources, type SetupDetection, type SetupImportResult, type SetupSource } from "../../shared/setup-import";
import { GrokBotMark } from "./GrokBotMark";
import { GrokMoveDialog } from "./lazy-screens";
import { ClaudeMark, CodexMark, CursorMark, PresetProviderMark } from "./ProviderIcons";
import { Card as RowsCard, CheckRow, ItemRow, NoteRow } from "./ListRows";

function SourceMarks({ sources }: { sources: readonly SetupSource[] }) {
  const marks = [...new Set(sources.map((source) => (source === "claudeDesktop" ? "claudeCode" : source)))];
  return (
    <span className="mr-1.5 inline-flex items-center gap-1 align-[-1px]" aria-hidden="true">
      {marks.map((source) => {
        switch (source) {
          case "codex": return <CodexMark key={source} size={12} />;
          case "cursor": return <CursorMark key={source} size={12} />;
          case "gemini": return <PresetProviderMark key={source} preset="google" size={12} />;
          default: return <ClaudeMark key={source} size={12} />;
        }
      })}
    </span>
  );
}

export function ImportRow({ icon, label, summary, hint, sources, checked, disabled, onChange }: {
  icon: ReactNode;
  label: string;
  summary: string;
  hint: string;
  sources: readonly SetupSource[];
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <CheckRow
      leading={<span className="flex size-4 shrink-0 items-center justify-center text-ink-secondary">{icon}</span>}
      title={<span className="flex items-center gap-2">{label}<SourceMarks sources={sources} /></span>}
      hint={`${summary} · ${hint}`}
      checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    />
  );
}

export interface AiAppsImportViewProps {
  local: boolean;
  /** undefined while looking; null when the look failed. */
  detection: SetupDetection | null | undefined;
  chosen: { skills: boolean; tools: boolean };
  status: "idle" | "working" | "failed";
  result: SetupImportResult | null;
  onChoose: (chosen: { skills: boolean; tools: boolean }) => void;
  onBring: () => void;
}

export function AiAppsImportView({ local, detection, chosen, status, result, onChoose, onBring }: AiAppsImportViewProps) {
  const working = status === "working";
  let body: ReactNode;
  if (!local) body = <NoteRow>{t("settings.import.appsLocalOnly")}</NoteRow>;
  else if (detection === undefined) body = <NoteRow>{t("settings.import.appsLooking")}</NoteRow>;
  else if (result) {
    const { line, notes } = importOutcome(result);
    body = <div role="status" className="contents"><ItemRow title={line} hint={notes.length ? notes.join(" ") : undefined} /></div>;
  } else if (!detection || detectionCount(detection) === 0) {
    body = <NoteRow>{detection === null ? t("onboarding.import.error") : t("settings.import.appsNothing")}</NoteRow>;
  } else {
    body = (
      <>
        {detection.skills.length > 0 && (
          <ImportRow icon={<BookOpen size={14} />} label={t("onboarding.import.skills")} summary={skillsSummary(detection)}
            hint={t("onboarding.import.skillsHint")} sources={detectionSources(detection.skills)} checked={chosen.skills}
            disabled={working} onChange={(skills) => onChoose({ ...chosen, skills })} />
        )}
        {detection.tools.length > 0 && (
          <ImportRow icon={<Plug size={14} />} label={t("onboarding.import.tools")} summary={toolsSummary(detection)}
            hint={t("onboarding.import.toolsHint")} sources={detectionSources(detection.tools)} checked={chosen.tools}
            disabled={working} onChange={(tools) => onChoose({ ...chosen, tools })} />
        )}
        {status === "failed" && <NoteRow tone="danger">{t("onboarding.import.error")}</NoteRow>}
      </>
    );
  }
  const offering = Boolean(local && detection && !result && detectionCount(detection) > 0);
  return (
    <section data-import-section="apps" className="contents">
      <RowsCard>
        <ItemRow title={t("settings.import.appsTitle")} hint={t("settings.w6c.import.appsSubtitle")}>
          {offering && <button type="button" onClick={onBring} disabled={working || !(chosen.skills || chosen.tools)} className="ui-button">
            {working ? t("onboarding.import.bringing") : t("onboarding.import.bring")}
          </button>}
        </ItemRow>
        {body}
      </RowsCard>
    </section>
  );
}

/** The welcome step's importer, outside the tour: look, tick, bring in. */
function AiAppsImport({ client, local }: { client: SetupImportClient; local: boolean }) {
  const [detection, setDetection] = useState<SetupDetection | null | undefined>(undefined);
  const [chosen, setChosen] = useState({ skills: true, tools: true });
  const [status, setStatus] = useState<"idle" | "working" | "failed">("idle");
  const [result, setResult] = useState<SetupImportResult | null>(null);

  useEffect(() => {
    if (!local) return;
    const controller = new AbortController();
    client.detect(controller.signal).then(setDetection, () => setDetection(null));
    return () => controller.abort();
  }, [client, local]);

  const bring = async () => {
    if (!detection || status === "working") return;
    const request = { ...(chosen.skills && detection.skills.length ? { skills: true } : {}), ...(chosen.tools && detection.tools.length ? { tools: true } : {}) };
    if (!request.skills && !request.tools) return;
    setStatus("working");
    try {
      const brought = await client.apply(request);
      track("setup_import_applied", { skills: brought.skills?.added.length ?? 0, tools: brought.tools?.added.length ?? 0 });
      setResult(brought);
      setStatus("idle");
    } catch {
      setStatus("failed");
    }
  };

  return <AiAppsImportView local={local} detection={detection} chosen={chosen} status={status} result={result} onChoose={setChosen} onBring={() => void bring()} />;
}

export function GrokImportSection() {
  const [open, setOpen] = useState(false);
  return (
    <section data-import-section="grok" className="contents">
      <RowsCard>
        <ItemRow title={<span className="flex items-center gap-2"><GrokBotMark size={14} />{t("settings.import.grokTitle")}</span>} hint={t("settings.w6c.import.grokSubtitle")}>
          <button type="button" data-grok-move-open onClick={() => setOpen(true)} className="ui-button">{t("settings.w6c.import.start")}</button>
        </ItemRow>
      </RowsCard>
      {open && <GrokMoveDialog onClose={() => setOpen(false)} />}
    </section>
  );
}

export function ImportSettings({ client = setupImportApi }: { client?: SetupImportClient }) {
  const { state } = useStore();
  const local = localSetupImport(state.config?.cloudHome === true);
  return (
    <>
      {local && <AiAppsImport client={client} local />}
      <GrokImportSection />
    </>
  );
}
