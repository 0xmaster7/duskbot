import { plainPreviewText } from "@/lib/plain-preview";
import { useMemo, useState, type ComponentType } from "react";
import { BotAvatar, MausAvatar } from "@/components/Avatar";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { api, openBotThread, openRoomThread, useStore } from "@/state/store";
import type { NotificationLogEntry } from "../../../shared/notification";
import { haptic } from "../haptics";
import { Sheet } from "../Sheet";
import { listTime } from "../time";
import { SettingsSection } from "./SettingsRow";
import type { SheetPageProps } from "./registry";

export function groupNotifications(entries: readonly NotificationLogEntry[], now = Date.now()) {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const groups: Record<"today" | "yesterday" | "earlier", NotificationLogEntry[]> = { today: [], yesterday: [], earlier: [] };
  for (const entry of [...entries].sort((a, b) => b.at - a.at)) {
    groups[entry.at >= today.getTime() ? "today" : entry.at >= yesterday.getTime() ? "yesterday" : "earlier"].push(entry);
  }
  return groups;
}

export const NotificationsSheet: ComponentType<SheetPageProps<"notifications">> = ({ open, onClose, onOpenChat }) => {
  const { state, dispatch } = useStore();
  const [reading, setReading] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const [error, setError] = useState<"read" | "missing" | null>(null);
  const groups = useMemo(() => groupNotifications(state.notifications), [state.notifications]);
  const unread = state.notifications.some((entry) => !entry.read);

  const readAll = async () => {
    if (reading) return;
    setReading(true);
    setError(null);
    const ids = state.notifications.filter((entry) => !entry.read).map((entry) => entry.id);
    try {
      await api("/api/notifications/read-all", { method: "POST" });
      dispatch({ type: "notificationsRead", ids });
    } catch {
      setError("read");
      haptic("error");
    } finally {
      setReading(false);
    }
  };

  const openEntry = async (entry: NotificationLogEntry) => {
    if (opening) return;
    setOpening(entry.id);
    setError(null);
    try {
      await api(`/api/notifications/${encodeURIComponent(entry.id)}/read`, { method: "POST" });
      dispatch({ type: "notificationRead", id: entry.id });
      if (entry.groupId) {
        if (!state.groups.some((group) => group.id === entry.groupId)) { setError("missing"); haptic("error"); return; }
        onOpenChat(entry.groupId);
        openRoomThread(dispatch, { groupId: entry.groupId, threadId: entry.threadId }, state.groups);
      } else {
        const bot = state.bots.find((candidate) => candidate.id === entry.botId);
        if (!bot) { setError("missing"); haptic("error"); return; }
        onOpenChat(bot.id);
        openBotThread(dispatch, bot, entry.threadId, true);
      }
    } catch {
      setError("read");
      haptic("error");
    } finally {
      setOpening(null);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title={t("mobile.notifications.title")} full trailing={<button type="button" disabled={!unread || reading} onClick={() => { void readAll(); }} className="mobile-press min-h-11 min-w-11 rounded-full px-3 text-[14px] font-semibold text-ink disabled:opacity-40">{t("mobile.notifications.readAll")}</button>}>
      {error && <p role="alert" className="px-6 py-3 text-[14px] text-danger">{t(error === "missing" ? "mobile.notifications.chatMissing" : "mobile.notifications.readError")}</p>}
      {state.notifications.length === 0 ? (
        <div className="flex flex-col items-center px-8 pt-20 text-center">
          <MausAvatar color="blue" size={80} state="happy" animated={false} label="" />
          <h2 className="mt-5 text-[22px] font-semibold text-ink">{t("mobile.notifications.emptyTitle")}</h2>
          <p className="mt-2 max-w-[280px] text-[14px] leading-5 text-ink-secondary">{t("mobile.notifications.emptyBody")}</p>
        </div>
      ) : (
        <div className="px-2 pt-2" aria-busy={reading || Boolean(opening)}>
          {(["today", "yesterday", "earlier"] as const).map((day) => groups[day].length > 0 && (
            <SettingsSection key={day} title={t(`mobile.notifications.${day}`)}>
              <ul>
                {groups[day].map((entry) => {
                  const bot = state.bots.find((candidate) => candidate.id === entry.botId);
                  return (
                    <li key={entry.id}>
                      <button type="button" disabled={Boolean(opening)} onClick={() => { void openEntry(entry); }} aria-label={!entry.read ? t("mobile.notifications.unread", { title: entry.title }) : undefined} className="mobile-row flex min-h-[76px] w-full items-start gap-3 rounded-2xl px-4 py-3 text-left disabled:opacity-60">
                        <span className="shrink-0">{bot ? <BotAvatar bot={bot} size={40} animated={false} label="" /> : <MausAvatar color="blue" size={40} animated={false} label="" />}</span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-baseline gap-2">
                            <span className={cn("min-w-0 flex-1 text-[15px] leading-5 text-ink", entry.read ? "font-medium" : "font-semibold")}>{entry.title}</span>
                            <time dateTime={new Date(entry.at).toISOString()} className="shrink-0 text-[13px] text-ink-tertiary">{listTime(entry.at)}</time>
                          </span>
                          <span className="mt-1 flex items-center gap-2">
                            <span className="line-clamp-2 min-w-0 flex-1 text-[14px] leading-5 text-ink-secondary">{plainPreviewText(entry.body)}</span>
                            {!entry.read && <span aria-hidden className="size-2 shrink-0 rounded-full bg-ink" />}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </SettingsSection>
          ))}
        </div>
      )}
    </Sheet>
  );
};
