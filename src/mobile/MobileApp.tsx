import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MotionConfig } from "motion/react";
import { openBot, openBotThread, openRoomThread, StoreProvider, useStore } from "@/state/store";
import { useTeamChats } from "@/state/team-chats";
import { useWarmChatImages } from "@/components/use-warm-chat-images";
import { ThreadRefsProvider } from "@/components/ThreadRefs";
import { DesktopCapabilitiesProvider } from "@/components/DesktopCapabilities";
import { LiveCallHost } from "@/components/LiveCallHost";
import { ConnectAppsHost } from "@/components/connect-apps";
import { openChatLink } from "@/components/ThreadRefs";
import { parseBotRefUrl, parseThreadRefUrl } from "@/lib/thread-refs"; import { completeSlackOAuth } from "@/lib/slack-oauth-link"; import { parseSlackOAuthLink } from "../../shared/slack";
import { effectiveLanguage, useLanguageChoice, usePageLanguage } from "@/lib/language-preference";
import { parseMobileOpenLink, type MobileOpenTarget } from "../../shared/mobile-link";
import { NavStack } from "./NavStack";
import { ChatScreen } from "./ChatScreen";
import { HomeScreen, releasePressed } from "./HomeScreen";
import { SheetHost } from "./SheetHost";
import { closeTopSheet } from "./Sheet";
import { useKeyboardSync } from "./keyboard";
import { useChatHaptics } from "./use-chat-haptics";
import { usePlatform } from "./platform";
import type { MobileSheet } from "./sheets";

function Shell() {
  const platform = usePlatform();
  const { state, dispatch } = useStore();
  const rootRef = useRef<HTMLDivElement>(null);
  const [chatId, setChatId] = useState<string | null>(null);
  const [sheet, setSheet] = useState<MobileSheet | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  useTeamChats(state.config);
  useWarmChatImages(state.bots);
  usePageLanguage(effectiveLanguage(useLanguageChoice(), state.config?.language));
  useKeyboardSync(platform, rootRef);
  useChatHaptics(state, chatId);

  const latest = useRef(state);
  latest.current = state;

  const openChat = useCallback((id: string) => {
    const current = latest.current;
    const bot = current.bots.find((b) => b.id === id);
    if (bot) openBot(dispatch, bot);
    else dispatch({ type: "select", id });
    setChatId(id);
  }, [dispatch]);

  const openSheet = useCallback((next: MobileSheet) => {
    setSheet(next);
    setSheetOpen(true);
  }, []);
  const closeSheet = useCallback(() => setSheetOpen(false), []);

  const openTarget = useCallback((target: MobileOpenTarget) => {
    const id = target.botId ?? target.groupId;
    if (id) {
      const bot = latest.current.bots.find((b) => b.id === id);
      if (bot && target.threadId) { openBotThread(dispatch, bot, target.threadId, true); setChatId(bot.id); }
      else if (target.groupId && target.threadId) { openRoomThread(dispatch, { groupId: target.groupId, threadId: target.threadId }, latest.current.groups); setChatId(target.groupId); }
      else openChat(id);
      if (target.messageId && target.threadId) dispatch({ type: "focusMessage", threadId: target.threadId, messageId: target.messageId });
    }
    if (target.view === "computer" && target.botId) openSheet({ kind: "computer", botId: target.botId });
    else if (target.view === "profile" && id) openSheet({ kind: "profile", id });
    else if (target.view === "settings") openSheet({ kind: "settings" });
    else if (target.view === "notifications") openSheet({ kind: "notifications" });
    else if (target.view === "routines") openSheet({ kind: "routines", botId: target.botId });
  }, [dispatch, openChat, openSheet]);

  useEffect(() => platform.onAppUrl?.((url) => {
    if (parseSlackOAuthLink(url)) { void completeSlackOAuth(url); return true; }
    const target = parseMobileOpenLink(url);
    if (target) { openTarget(target); return true; }
    // the desktop's own chat links open the same chat here
    const bot = parseBotRefUrl(url);
    const thread = parseThreadRefUrl(url);
    if (!bot && !thread) return false;
    if (openChatLink(dispatch, url, latest.current, true)) {
      const owner = bot?.botId ?? thread?.botId ?? latest.current.groups.find((g) => g.threadId === thread?.threadId || g.tasks?.some((task) => task.threadId === thread?.threadId))?.id
        ?? latest.current.bots.find((b) => b.threadId === thread?.threadId || b.tasks?.some((task) => task.threadId === thread?.threadId))?.id;
      if (owner) setChatId(owner);
    }
    return true;
  }), [platform, openTarget, dispatch]);
  useEffect(() => platform.onNotificationOpen?.(openTarget), [platform, openTarget]);

  useEffect(() => platform.onBack?.(() => {
    if (closeTopSheet()) return true;
    if (chatId) { setChatId(null); return true; }
    return false;
  }), [platform, chatId]);

  // a resumed app reads the chat on screen, as a refocused desktop window does
  useEffect(() => platform.onResume?.(() => { if (chatId) dispatch({ type: "select", id: chatId }); }), [platform, chatId, dispatch]);

  const group = chatId ? state.groups.find((g) => g.id === chatId) : undefined;
  const bot = chatId && !group ? state.bots.find((b) => b.id === chatId) : undefined;
  const members = useMemo(() => group ? state.bots.filter((b) => group.memberIds.includes(b.id)) : [], [group, state.bots]);
  useEffect(() => { if (chatId && state.hydrated && !group && !bot) setChatId(null); }, [chatId, state.hydrated, group, bot]);

  const page = bot || group ? (
    <ChatScreen
      bot={bot}
      group={group}
      members={members}
      onBack={() => setChatId(null)}
      onProfile={() => openSheet({ kind: "profile", id: chatId! })}
      onComputer={bot ? () => openSheet({ kind: "computer", botId: bot.id }) : undefined}
    />
  ) : null;

  return (
    <div ref={rootRef} className="omb-mobile relative">
      <NavStack
        base={<HomeScreen onOpenChat={openChat} onOpenSheet={openSheet} />}
        page={page}
        pageKey={page ? chatId : null}
        onBack={() => setChatId(null)}
        onSettled={releasePressed}
      />
      <SheetHost sheet={sheet} open={sheetOpen} onClose={closeSheet} onOpenSheet={openSheet} onOpenChat={(id) => { closeSheet(); openChat(id); }} />
      <ConnectAppsHost />
    </div>
  );
}

export function MobileApp() {
  return (
    <MotionConfig reducedMotion="user">
      <DesktopCapabilitiesProvider>
        <StoreProvider>
          <ThreadRefsProvider>
            <Shell />
          </ThreadRefsProvider>
          <LiveCallHost />
        </StoreProvider>
      </DesktopCapabilitiesProvider>
    </MotionConfig>
  );
}
