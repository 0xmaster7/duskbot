import { ChevronLeft, Monitor } from "../icons";
import { useStore, type Bot, type Group } from "@/state/store";
import { ChatView } from "@/components/ChatView";
import { GroupView } from "@/components/GroupView";
import { BotAvatar } from "@/components/Avatar";
import { GroupAvatar } from "@/components/GroupAvatar";
import { t } from "@/lib/i18n";
import { RoundButton } from "./RoundButton";

/** The shared chat, with Grok's floating nav in place of its header row: back, the bot's pill (its profile), and the
 * computer. The shared header keeps its height under the nav, so the transcript starts where it always does. */
export function ChatScreen({ bot, group, members, onBack, onProfile, onComputer }: {
  bot?: Bot;
  group?: Group;
  members: Bot[];
  onBack: () => void;
  onProfile: () => void;
  onComputer?: () => void;
}) {
  const { state } = useStore();
  const name = group?.name ?? bot?.name ?? "";
  const live = Boolean(bot && (bot.busy || state.computerControl[bot.id]?.held));
  return (
    <div data-mobile-chat className="relative flex h-full flex-col">
      {group ? <GroupView key={group.id} group={group} /> : bot ? <ChatView bot={bot} /> : null}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 z-[29] h-[calc(var(--m-safe-top)+68px)] bg-gradient-to-b from-app from-55% to-transparent" />
      <nav
        aria-label={t("mobile.chat.nav", { name })}
        className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-center gap-2 px-3 pt-[calc(var(--m-safe-top)+6px)]"
      >
        <RoundButton floating label={t("mobile.chat.back")} onClick={onBack} className="pointer-events-auto">
          <ChevronLeft size={22} strokeWidth={2} />
        </RoundButton>
        <button
          type="button"
          onClick={onProfile}
          aria-label={t("mobile.chat.openProfile", { name })}
          className="mobile-press mobile-float pointer-events-auto flex h-11 min-w-0 max-w-[60%] items-center gap-2 rounded-full bg-composer pl-1.5 pr-4 text-ink"
        >
          {group
            ? <GroupAvatar members={members} size={30} />
            : bot && <BotAvatar bot={bot} size={30} state="idle" animated={false} />}
          <span className="min-w-0 truncate text-[15px] font-semibold">{name}</span>
        </button>
        <div className="flex-1" />
        {onComputer && (
          <RoundButton floating label={live ? `${t("mobile.chat.computer")}, ${t("place.live")}` : t("mobile.chat.computer")} onClick={onComputer} className="pointer-events-auto">
            <Monitor size={19} strokeWidth={1.8} />
            {live && <span aria-hidden className="absolute right-2.5 top-2.5 size-2 rounded-full bg-success ring-2 ring-composer" />}
          </RoundButton>
        )}
      </nav>
    </div>
  );
}
