import { useEffect, useState } from "react";
import { t } from "@/lib/i18n";
import {
  setFinishedNotifications,
  setNotificationFeed,
  setNotificationSounds,
  useFinishedNotifications,
  useNotificationFeed,
  useNotificationSounds,
} from "@/lib/notification-preferences";
import { requestNotificationPermission } from "@/lib/notify";
import { chooseSound, chosenSound, play, UI_SOUND_NAMES, type UiSoundName } from "@/lib/ui-sounds";
import type { LocaleKey } from "@/locales";
import { SettingRow, Switch } from "./SettingsPrimitives";
import { SettingsSelect } from "./SettingsSelect";

export function NotificationRows({ simple = false }: { simple?: boolean }) {
  return (
    <>
      <DeviceNotificationsRow simple={simple} />
      <NotificationSoundsRow simple={simple} />
      {simple && <NotificationSoundPickerRow />}
      <NotificationFeedRow simple={simple} />
    </>
  );
}

const currentPermission = (): NotificationPermission => (typeof Notification !== "undefined" ? Notification.permission : "default");

/** A browser shows nothing until it is asked from a click; the person may also change the site permission elsewhere. */
export function DeviceNotificationsRow({ simple = false }: { simple?: boolean }) {
  const [permission, setPermission] = useState(currentPermission);
  const enabled = useFinishedNotifications();
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") setPermission(currentPermission());
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
  if (typeof Notification === "undefined") return null;

  const blocked = permission === "denied";
  const toggle = async () => {
    if (permission === "granted") return setFinishedNotifications(!enabled);
    const next = await requestNotificationPermission();
    if (!next) return;
    setPermission(next);
    if (next === "granted") setFinishedNotifications(true);
  };

  return (
    <SettingRow
      title={t("settings.deviceNotifications.title")}
      subtitle={t(blocked ? "settings.deviceNotifications.blocked" : simple ? "settings.simple.deviceNotifications" : "settings.deviceNotifications.subtitle")}
    >
      <Switch
        checked={permission === "granted" && enabled}
        disabled={blocked}
        aria-label={t("settings.deviceNotifications.show")}
        onClick={() => void toggle()}
      />
    </SettingRow>
  );
}

export function NotificationSoundsRow({ simple = false }: { simple?: boolean }) {
  const enabled = useNotificationSounds();
  return (
    <SettingRow title={t(simple ? "settings.notificationSound.playTitle" : "settings.notificationSounds.title")} subtitle={t(simple ? "settings.simple.notificationSounds" : "settings.notificationSounds.subtitle")}>
      <Switch
        checked={enabled}
        aria-label={t("settings.notificationSounds.play")}
        onClick={() => setNotificationSounds(!enabled)}
      />
    </SettingRow>
  );
}

export function NotificationFeedRow({ simple = false }: { simple?: boolean }) {
  const enabled = useNotificationFeed();
  return (
    <SettingRow title={t("settings.notificationFeed.title")} subtitle={t(simple ? "settings.simple.notificationFeed" : "settings.notificationFeed.subtitle")}>
      <Switch
        checked={enabled}
        aria-label={t("settings.notificationFeed.show")}
        onClick={() => setNotificationFeed(!enabled)}
      />
    </SettingRow>
  );
}

const SOUND_LABELS: Record<UiSoundName, LocaleKey> = {
  "open-blip": "settings.notificationSound.openBlip",
  tick: "settings.notificationSound.tick",
  "double-tick": "settings.notificationSound.doubleTick",
  "chime-a": "settings.notificationSound.chimeA",
  "chime-b": "settings.notificationSound.chimeB",
};

/** Grok's ping picker: which of its five pings plays, heard once as it is chosen. Hidden while sounds are off. */
export function NotificationSoundPickerRow() {
  const enabled = useNotificationSounds();
  const [sound, setSound] = useState<UiSoundName>(chosenSound);
  if (!enabled) return null;
  return (
    <SettingRow title={t("settings.notificationSound.title")} subtitle={t("settings.notificationSound.subtitle")}>
      <SettingsSelect
        value={sound}
        aria-label={t("settings.notificationSound.title")}
        options={UI_SOUND_NAMES.map((name) => ({ value: name, label: t(SOUND_LABELS[name]) }))}
        onChange={(event) => {
          const name = UI_SOUND_NAMES.find((candidate) => candidate === event.target.value);
          if (!name) return;
          chooseSound(name);
          setSound(name);
          play(name, { force: true });
        }}
      />
    </SettingRow>
  );
}
