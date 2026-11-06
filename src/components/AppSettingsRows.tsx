import { useState } from "react";
import { api, useStore, type ConfigStatus } from "@/state/store";
import { builtInBrowserEnabled, showToolCallsEnabled, skillAuthoringEnabled } from "@/lib/feature-flags";
import { localeChoices } from "@/locales";
import { activeLocale, t } from "@/lib/i18n";
import { withTourReset } from "@/lib/guided-tour";
import { completionPatch } from "@/lib/onboarding";
import { useUpdaterState } from "@/lib/updater";
import { productName } from "../lib/brand";
import { BrowserProfilesManager } from "./BrowserProfilesManager";
import { NewBrowserSettings } from "./BrowserSettingsRows";
import { NavRow } from "./ListRows";
import { Card, SIMPLE_CARD, SettingRow, Switch } from "./SettingsPrimitives";
import { cn } from "@/lib/cn";
import { LearnedSkillsSettings } from "./ShareLearnedSkillsSettings";
import { effortLabel } from "./ModelPicker";
import { EFFORT_LEVELS, isEffortLevel } from "../../shared/wire";
import { setColorUserBubbles, useColorUserBubbles } from "@/lib/user-bubble-preference";
import { setAdvancedMode, useAdvancedMode } from "@/lib/interface-mode";
import { setPinnedCircles, setUniversalPins, usePinnedCircles, useUniversalPins } from "@/lib/sidebar-preferences";
import { parseSendKey, SEND_KEYS, sendKeyLabel, setSendKey, useSendKey } from "@/lib/send-key";
import { alternateSendLabel, parseFollowUpDefault, setFollowUpDefault, useFollowUpDefault } from "@/lib/follow-up";
import { effectiveLanguage, setLanguageChoice, useLanguageChoice } from "@/lib/language-preference";
import { SettingsSelect } from "./SettingsSelect";

export function UpdatesRow({ title = t("settings.updates.title") }: { title?: string }) {
  const s = useUpdaterState();
  const updater = window.ogb?.updater;
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
                  : t("settings.updates.latest");
  return (
    <SettingRow title={title} subtitle={label}>
      <button
        onClick={() => {
          if (s.status === "downloaded") return void updater.install();
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

/** The two tours as rows of Help: the app tour (marking onboarding done if it was not) and the welcome tour. */
export function ReplayTourRows() {
  const { state, dispatch } = useStore();
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const replayApp = () => {
    setSaving(true);
    setFailed(false);
    void api("/api/config", {
      method: "PUT",
      body: JSON.stringify({ onboarding: {
        ...(!state.config?.onboarding?.completedAt ? completionPatch().onboarding : {}),
        hintsSeen: withTourReset(state.config?.onboarding),
      } }),
      signal: AbortSignal.timeout(10_000),
    })
      .then((config) => {
        dispatch({ type: "configStatus", config });
        dispatch({ type: "toggleTour", open: true });
      })
      .catch(() => setFailed(true))
      .finally(() => setSaving(false));
  };
  return (
    <>
      <NavRow data-settings-open="app-tour" drill={false} disabled={saving} title={t("settings.welcome.appTour")} hint={failed ? t("onboarding.tour.error") : undefined} onClick={replayApp} />
      <NavRow data-settings-open="welcome-tour" drill={false} title={t("settings.welcome.replay")} onClick={() => dispatch({ type: "toggleWelcome", open: true })} />
    </>
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

export function ColorUserBubblesRow({ simple = false }: { simple?: boolean }) {
  const enabled = useColorUserBubbles();
  return (
    <SettingRow title={t("settings.userBubbles.title")} subtitle={simple ? undefined : t("settings.userBubbles.subtitle")}>
      <Switch
        checked={enabled}
        aria-label={t("settings.userBubbles.aria")}
        onClick={() => setColorUserBubbles(!enabled)}
      />
    </SettingRow>
  );
}

export function AdvancedModeRow({ simple = false }: { simple?: boolean }) {
  const enabled = useAdvancedMode();
  return (
    <SettingRow className={simple ? undefined : "rounded-2xl border border-accent-border/40 bg-raised-hover/40 py-4"} title={t("settings.advancedMode.title")}
      subtitle={t(simple ? "settings.simple.advancedMode" : "settings.advancedMode.subtitle")}>
      <Switch
        checked={enabled}
        aria-label={t("settings.advancedMode.title")}
        onClick={() => setAdvancedMode(!enabled)}
      />
    </SettingRow>
  );
}

export function PinnedCirclesRow() {
  const enabled = usePinnedCircles();
  return (
    <SettingRow title={t("settings.pinnedCircles.title")}>
      <Switch
        checked={enabled}
        aria-label={t("settings.pinnedCircles.title")}
        onClick={() => setPinnedCircles(!enabled)}
      />
    </SettingRow>
  );
}

export function UniversalPinsRow() {
  const enabled = useUniversalPins();
  return (
    <SettingRow title={t("settings.universalPins.title")}>
      <Switch
        checked={enabled}
        aria-label={t("settings.universalPins.title")}
        onClick={() => setUniversalPins(!enabled)}
      />
    </SettingRow>
  );
}

export function ToolCallsRow() {
  const { state, dispatch } = useStore();
  const enabled = showToolCallsEnabled(state.config);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const toggle = async () => {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      const config: ConfigStatus = await api("/api/config", {
        method: "PATCH",
        body: JSON.stringify({ features: { showToolCalls: !enabled } }),
      });
      dispatch({ type: "configStatus", config });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("settings.toolCalls.error"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingRow
      title={t("settings.toolCalls.title")}
      message={error ? <p role="alert" className="text-danger">{error}</p> : null}
    >
      <Switch
        checked={enabled}
        aria-label={t("settings.toolCalls.aria")}
        disabled={saving}
        onClick={() => void toggle()}
        className="disabled:cursor-wait disabled:opacity-50"
      />
    </SettingRow>
  );
}

export function ExperimentalFeaturesRow() {
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

export function BrowserProfilesRow() {
  const { state } = useStore();
  const profiles = state.config?.browserProfiles ?? [];
  if (!builtInBrowserEnabled(state.config) && profiles.length === 0) return null;
  return (
    <Card title={t("settings.profiles.title")}>
      <BrowserProfilesManager folded />
    </Card>
  );
}
