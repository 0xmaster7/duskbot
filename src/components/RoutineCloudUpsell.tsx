import { useEffect, useMemo, useRef, useState } from "react";
import { alwaysOnCooling, markAlwaysOn, trackUpsell } from "@/lib/cloud-upsell";
import { t } from "@/lib/i18n";
import { madeSince, newRoutineSinceBaseline } from "@/lib/routine-cloud-upsell";
import { useAppTriggers } from "@/lib/app-triggers";
import { useStore } from "@/state/store";
import { useCloudUpsell } from "./CloudUpsell";
import { useDesktopCapabilities } from "./DesktopCapabilities";
import { deviceWord } from "./vps-link/parts";
import { GrokDialog, mdPrimaryCls, mdSecondaryCls } from "./ui/GrokDialog";

export function RoutineCloudUpsell({ quiet = false }: { quiet?: boolean }) {
  const { state } = useStore();
  const upsell = useCloudUpsell();
  const { capabilities } = useDesktopCapabilities();
  const appTriggers = useAppTriggers();
  const seen = useRef<ReadonlySet<string>>(new Set());
  const opened = useRef(Date.now());
  const shownAt = useRef(0);
  const [pending, setPending] = useState<string | null>(null);
  const [shown, setShown] = useState<string | null>(null);
  // a schedule, or something another app starts (its events or its messages), made on this computer
  const made = useMemo(() => [
    ...madeSince(state.routines, opened.current).map(entry => ({ id: entry.id, name: entry.name, enabled: entry.enabled, heldFor: entry.heldFor, event: false })),
    ...madeSince(state.webhooks, opened.current).filter(entry => entry.runOn === "maus").map(entry => ({ id: entry.id, name: entry.name, enabled: entry.enabled !== false, heldFor: undefined, event: true })),
    ...madeSince(appTriggers.triggers, opened.current).filter(entry => entry.runOn === "maus").map(entry => ({ id: entry.id, name: entry.name, enabled: entry.enabled, heldFor: undefined, event: true })),
  ], [state.routines, state.webhooks, appTriggers.triggers]);
  useEffect(() => {
    if (state.routinesLoadState !== "ready") return;
    const next = newRoutineSinceBaseline(seen.current, made);
    seen.current = next.seen ?? seen.current;
    if (next.created) setPending(next.created.id);
  }, [made, state.routinesLoadState]);
  const allowed = upsell.allowed === true;
  const waits = quiet || !state.connected || state.appSettingsOpen || state.settingsOpen || state.pluginsOpen
    || state.shortcutsOpen || state.welcomeOpen || Boolean(state.cloudAdd) || state.cloudHowTo || state.botCreationPending;
  useEffect(() => {
    if (!pending || shown || !allowed || waits) return;
    const routine = made.find(entry => entry.id === pending);
    if (!routine?.enabled || routine.heldFor) { setPending(null); return; }
    setPending(null);
    if (shownAt.current || alwaysOnCooling()) return;
    shownAt.current = Date.now();
    markAlwaysOn(shownAt.current);
    trackUpsell("shown", "app_routines");
    setShown(routine.id);
  }, [pending, shown, allowed, waits, made]);
  const routine = made.find(entry => entry.id === shown);
  if (!allowed || waits || !routine?.enabled || routine.heldFor) return null;
  const close = () => { setShown(null); setPending(null); };
  const notNow = () => { trackUpsell("dismiss", "app_routines"); close(); };
  return <GrokDialog title={<span className="block whitespace-normal">{routine.event ? t("routines.cloudUpsell.titleEvent", { device: deviceWord() }) : t(capabilities.host.platform === "darwin" ? "routines.cloudUpsell.titleMac" : "routines.cloudUpsell.title")}</span>}
    description={routine.event ? t("routines.cloudUpsell.bodyEvent", { name: routine.name, device: deviceWord() }) : t("routines.cloudUpsell.body", { name: routine.name })} width={460} onClose={notNow}
    footer={<>
      <button type="button" className={mdSecondaryCls} onClick={notNow}>{t("notice.notNow")}</button>
      <button type="button" className={mdPrimaryCls} onClick={() => {
        trackUpsell("click", "app_routines");
        close();
        upsell.open("app_routines");
      }}>{t("routines.cloudUpsell.getCloud")}</button>
    </>}>
    <dl className="my-2 flex flex-col gap-3 text-[13px]">
      <div className="flex items-center justify-between gap-4"><dt>{t("rail.thisComputer")}</dt><dd className="text-ink-secondary">{t("routines.cloudUpsell.asleep")}</dd></div>
      <div className="flex items-center justify-between gap-4"><dt>{t("routines.cloudUpsell.cloud")}</dt><dd className="text-ink-secondary">{t("routines.cloudUpsell.alwaysOn")}</dd></div>
    </dl>
  </GrokDialog>;
}
