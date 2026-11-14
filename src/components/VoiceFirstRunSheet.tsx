// The first tap on the mic: which recognizer listens, and a quiet way to choose a service instead. Shown once.
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import type { systemEngineWhere } from "@/lib/voice-input/engines";
import { GrokDialog, mdPrimaryCls } from "./ui/GrokDialog";

type Where = ReturnType<typeof systemEngineWhere>;

const TITLES: Record<Where, LocaleKey> = {
  mac: "composer.voice.firstRun.mac",
  windows: "composer.voice.firstRun.windows",
  linux: "composer.voice.firstRun.linux",
  iphone: "composer.voice.firstRun.iphone",
  android: "composer.voice.firstRun.android",
  browser: "composer.voice.firstRun.browser",
};

export function VoiceFirstRunSheet({ where, onContinue, onSetUp, onClose }: {
  where: Where;
  onContinue: () => void;
  onSetUp: () => void;
  onClose: () => void;
}) {
  return (
    <GrokDialog
      data-panel-modal="voice-first-run"
      title={t(TITLES[where])}
      width={400}
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            data-voice-setup=""
            onClick={onSetUp}
            className="me-auto cursor-pointer rounded-[6px] text-start text-[13px] leading-[18px] text-ink/68 underline-offset-2 transition-colors duration-100 ease-[ease] hover:text-ink hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            {t("composer.voice.firstRun.setUp")}
          </button>
          <button type="button" data-autofocus="" className={mdPrimaryCls} onClick={onContinue}>
            {t("composer.voice.firstRun.continue")}
          </button>
        </>
      }
    >
      <p className="m-0 text-pretty text-[13px] leading-[18px] text-ink/68">{t("composer.voice.firstRun.body")}</p>
    </GrokDialog>
  );
}
