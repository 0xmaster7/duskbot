import { useEffect, useState, type ReactNode } from "react";
import { api, useStore, type ConfigStatus } from "@/state/store";
import { skillAuthoringEnabled } from "@/lib/feature-flags";
import { localeChoices } from "@/locales";
import { activeLocale, t } from "@/lib/i18n";
import { useUpdaterState } from "@/lib/updater";
import { productName } from "../lib/brand";
import { NewBrowserSettings } from "./BrowserSettingsRows";
import { SIMPLE_CARD, SettingRow, Switch } from "./SettingsPrimitives";
import { cn } from "@/lib/cn";
import { LearnedSkillsSettings } from "./ShareLearnedSkillsSettings";
import { effortLabel } from "./ModelPicker";
import { EFFORT_LEVELS, isEffortLevel } from "../../shared/wire";
import { parseSendKey, SEND_KEYS, sendKeyLabel, setSendKey, useSendKey } from "@/lib/send-key";
import { alternateSendLabel, parseFollowUpDefault, setFollowUpDefault, useFollowUpDefault } from "@/lib/follow-up";
import { effectiveLanguage, setLanguageChoice, useLanguageChoice } from "@/lib/language-preference";
import { SettingsSelect } from "./SettingsSelect";
import { TALKING_STYLES, talkingStyleOf } from "../../shared/talking-style";

const UP_TO_DATE_MS = 3000;

export function UpdatesRow({ title = t("settings.updates.title") }: { title?: string }) {
  const s = useUpdaterState();
  const updater = window.ogb?.updater;
  const [asked, setAsked] = useState(false);
  const answered = asked && s?.status === "idle";
  useEffect(() => {
    if (!answered) return;
    const timer = setTimeout(() => setAsked(false), UP_TO_DATE_MS);
    return () => clearTimeout(timer);
  }, [answered]);
  if (!s || !updater) return null;
  const label =
    s.status === "checking"
      ? t("settings.updates.checking")
      : s.status === "downloading"
        ? s.percent == null
          ? t("settings.updates.startingDownload")
          : t("settings.updates.downloading", { percent: Math.round(s.percent) })
        : s.status === "preparing"
          ? t("settings.updates.preparing")
          : s.status === "downloaded"
            ? s.installMode === "handoff"
              ? t("settings.updates.readyInstall", { app: productName(), version: s.version ?? "" })
              : t("settings.updates.ready", { app: productName(), version: s.version ?? "" })
            : s.status === "installing"
              ? s.message ||
                (s.installMode === "handoff"
                  ? t("settings.updates.openingTerminal")
                  : t("settings.updates.restarting"))
              : s.status === "handed-off"
                ? t("settings.updates.handedOff")
                : s.status === "error"
                  ? t("settings.updates.failed", { message: s.message ?? t("settings.updates.unknownError") })
                  : answered
                    ? t("sidebar.update.upToDate")
                    : t("settings.updates.latest");
  return (
    <SettingRow title={title} subtitle={label}>
      <button
        onClick={() => {
          if (s.status === "downloaded") return void updater.install();
          setAsked(true);
          void updater.check();
        }}
        disabled={
          s.status === "checking" || s.status === "downloading" || s.status === "preparing" ||
          s.status === "installing" || s.retryable === false
        }
        className="ui-button"
      >
        {s.retryable === false
          ? t("settings.updates.quitReopen")
          : s.status === "downloaded"
            ? s.installMode === "handoff"
              ? t("settings.updates.install")
              : t("settings.updates.restart")
            : s.status === "preparing"
              ? t("settings.updates.preparingShort")
              : s.status === "installing"
                ? s.installMode === "handoff"
                  ? t("settings.updates.opening")
                  : t("settings.updates.restartingShort")
                : t("settings.updates.check")}
      </button>
    </SettingRow>
  );
}

export function NewBotEffortRow() {
  const { state, dispatch } = useStore();
  const current = state.config?.newBots?.effort ?? "";
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = async (value: string) => {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      const config: ConfigStatus = await api("/api/config", {
        method: "PATCH",
        body: JSON.stringify({ newBots: { effort: isEffortLevel(value) ? value : null } }),
      });
      dispatch({ type: "configStatus", config });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("settings.newBotEffort.error"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingRow
      title={t("settings.newBotEffort.title")}
      message={error ? <p role="alert" className="text-danger">{error}</p> : null}
    >
      <SettingsSelect
        value={current}
        disabled={saving}
        aria-label={t("settings.newBotEffort.aria")}
        onChange={(event) => void save(event.target.value)}
      >
        <option value="">{t("settings.newBotEffort.default")}</option>
        {EFFORT_LEVELS.map((level) => (
          <option key={level} value={level}>
            {effortLabel(level)}
          </option>
        ))}
      </SettingsSelect>
    </SettingRow>
  );
}

/** How every bot talks, the choice the first run offers: casual, warm (the default) or native. */
export function TalkingStyleRow() {
  const { state, dispatch } = useStore();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const save = async (value: string) => {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      const config: ConfigStatus = await api("/api/config", { method: "PATCH", body: JSON.stringify({ talkingStyle: talkingStyleOf(value) }) });
      dispatch({ type: "configStatus", config });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("settings.talkingStyle.error"));
    } finally {
      setSaving(false);
    }
  };
  return (
    <SettingRow title={t("settings.talkingStyle.title")} message={error ? <p role="alert" className="text-danger">{error}</p> : null}>
      <SettingsSelect
        value={talkingStyleOf(state.config?.talkingStyle)}
        disabled={saving}
        aria-label={t("settings.talkingStyle.title")}
        data-settings-select="talking-style"
        options={TALKING_STYLES.map((style) => ({ value: style, label: t(`settings.talkingStyle.${style}`) }))}
        onChange={(event) => void save(event.target.value)}
      />
    </SettingRow>
  );
}

export function LanguageRow({ simple = false }: { simple?: boolean }) {
  const { state } = useStore();
  const current = effectiveLanguage(useLanguageChoice(), state.config?.language);

  return (
    <SettingRow
      title={t("settings.language.title")}
      subtitle={simple ? activeLocale() === "en" ? undefined : t("settings.simple.language.partial") : t("settings.language.subtitle")}
    >
      <SettingsSelect
        value={current}
        aria-label={t(simple ? "settings.language.title" : "settings.language.aria")}
        onChange={(event) => setLanguageChoice(event.target.value)}
      >
        <option value="">{t(simple ? "settings.simple.language.system" : "settings.language.system")}</option>
        {localeChoices.map(({ code, label }) => (
          <option key={code} value={code}>
            {label}
          </option>
        ))}
      </SettingsSelect>
    </SettingRow>
  );
}

export function SendKeyRow({ simple = false }: { simple?: boolean }) {
  const sendKey = useSendKey();
  return (
    <SettingRow title={t("settings.sendKey.title")} subtitle={simple ? undefined : t("settings.sendKey.subtitle", { key: sendKeyLabel("mod-enter") })}>
      <SettingsSelect
        value={sendKey}
        aria-label={t("settings.sendKey.title")}
        onChange={(event) => setSendKey(parseSendKey(event.target.value))}
      >
        {SEND_KEYS.map((mode) => (
          <option key={mode} value={mode}>{sendKeyLabel(mode)}</option>
        ))}
      </SettingsSelect>
    </SettingRow>
  );
}

/** What Enter does with a message sent while a bot works. A setting, not a smart default: both are right, for different people. */
export function FollowUpRow({ simple = false }: { simple?: boolean }) {
  const followUp = useFollowUpDefault();
  const key = alternateSendLabel(useSendKey());
  return (
    <SettingRow title={t("settings.followUp.title")} subtitle={simple ? undefined : t("settings.followUp.subtitle", { key })}>
      <SettingsSelect
        value={followUp}
        aria-label={t("settings.followUp.title")}
        onChange={(event) => setFollowUpDefault(parseFollowUpDefault(event.target.value))}
      >
        <option value="steer">{t("settings.followUp.steer")}</option>
        <option value="queue">{t("settings.followUp.queue")}</option>
      </SettingsSelect>
    </SettingRow>
  );
}

export function ExperimentalFeaturesRow({ lead }: { lead?: ReactNode }) {
  const { state, dispatch } = useStore();
  const skillAuthoring = skillAuthoringEnabled(state.config);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const toggle = async (next: boolean) => {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      const config: ConfigStatus = await api("/api/config", {
        method: "PATCH",
        body: JSON.stringify({ features: { skillAuthoring: next } }),
      });
      dispatch({ type: "configStatus", config });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("settings.experimental.error"));
    } finally {
      setSaving(false);
    }
  };

  return (
    // the sections below are shared with older screens: here they sit as plain rows, without their own rule and gap
    <div data-settings-rows="" className={cn(SIMPLE_CARD, "flex flex-col [&>[data-testid]]:mt-0 [&>[data-testid]]:border-t-0 [&>[data-testid]]:px-2 [&>[data-testid]]:py-1.5")}>
      {lead}
      <SettingRow title={t("settings.experimental.skillAuthoring")} message={error ? <span role="alert" className="text-danger">{error}</span> : null}>
        <Switch
          checked={skillAuthoring}
          aria-label={t("settings.experimental.skillAuthoringAria")}
          disabled={saving}
          onClick={() => void toggle(!skillAuthoring)}
        />
      </SettingRow>
      <LearnedSkillsSettings />
      <NewBrowserSettings />
    </div>
  );
}

