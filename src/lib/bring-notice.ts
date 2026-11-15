// The once-only corner card for someone who has other AI tools on this computer and never brought them in: the first
// run's bring step can be skipped, or never shown (dusk cloud, an older version), and Settings' import page is quiet.
import { useEffect, useState } from "react";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { useStore } from "@/state/store";
import { detectionSources, type SetupDetection, type SetupSource } from "../../shared/setup-import";
import { welcomeFinishedThisLaunch } from "./onboarding";
import { BRING_NOTICE, noticeSeen } from "./notices";
import { detectSetupWithin, localSetupImport, setupImportApi, type SetupImportClient } from "./setup-import";

const LOOK_MS = 4_000;

/** Worth a card: memory notes, or skills, not brought in yet. MCP servers alone are left to Settings. */
export function bringNoticeApps(detection: SetupDetection | null): SetupSource[] {
  if (!detection) return [];
  return detectionSources<SetupSource>([...(detection.memory ?? []).filter((one) => one.notes > 0), ...detection.skills]);
}

/** `fact`: null while looking, then whether the card is due; `apps`: the tools found, by name. */
export function useBringNotice(client: SetupImportClient = setupImportApi): { fact: boolean | null; apps: string[] } {
  const { state } = useStore();
  const record = state.config?.onboarding;
  const due = Boolean(state.config && record?.completedAt) && localSetupImport(state.config?.cloudHome === true)
    && !noticeSeen(record, BRING_NOTICE) && !welcomeFinishedThisLaunch();
  const [sources, setSources] = useState<SetupSource[] | null>(null);
  useEffect(() => {
    if (!due) return;
    const look = detectSetupWithin(client, LOOK_MS);
    void look.found.then((detection) => setSources(bringNoticeApps(detection)));
    return look.cancel;
  }, [due, client]);
  if (!due) return { fact: false, apps: [] };
  if (sources === null) return { fact: null, apps: [] };
  return { fact: sources.length > 0, apps: sources.map((source) => t(`onboarding.import.source.${source}` as LocaleKey)) };
}
