import { useEffect, useRef } from "react";
import { configure, feature, screen } from "./product-analytics";

export function startDesktopAnalytics(): void {
  const bridge = window.ogb;
  if (!bridge) return;
  const platform = bridge.platform;
  if (platform !== "darwin" && platform !== "win32" && platform !== "linux") return;
  const apply = (staging = false) => configure({
    origin: import.meta.env.VITE_DUSK_ACCOUNT_ORIGIN || (staging ? "https://dev.dusk.bot" : "https://app.dusk.bot"),
    token: null, platform, version: bridge.app?.version || __APP_VERSION__, kind: "desktop",
  });
  if (bridge.cloudAccount) void bridge.cloudAccount.state().then(state => apply(state.staging === true), () => apply());
  else apply();
}

export function useProductScreen(path: string, chatId?: string | null): void {
  const lastChat = useRef<string | null>(null);
  useEffect(() => { screen(path); }, [path]);
  useEffect(() => {
    if (chatId && lastChat.current !== chatId) feature("chat_opened");
    lastChat.current = chatId ?? null;
  }, [chatId]);
}

export function useComputerAnalytics(id: string, visible: boolean): void {
  const shown = useRef("");
  useEffect(() => {
    const current = visible ? id : "";
    if (current && shown.current !== current) feature("computer_used");
    shown.current = current;
  }, [id, visible]);
}
