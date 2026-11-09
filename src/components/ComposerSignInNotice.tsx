import { t } from "@/lib/i18n";
import { signedOutWithoutBackup } from "@/lib/failed-turn";
import { useStore, type Bot, type ConfigStatus } from "@/state/store";
import { NOTICE_LINE } from "./ChatErrorBanner";
import { useDesktopCapabilities } from "./DesktopCapabilities";

export function aiRunsOnServer(config: ConfigStatus | null | undefined, capabilities: ReturnType<typeof useDesktopCapabilities>["capabilities"]): boolean {
  return window.ogb?.remoteClient?.active === true || config?.cloudHome === true || capabilities.localComputer?.reasonCode === "remote-server";
}

/** grok's prompt notice before a send that could only fail: the bot's AI is signed out and no backup would answer. */
export function ComposerSignInNotice({ bot }: { bot: Bot }) {
  const { state, dispatch } = useStore();
  const { capabilities } = useDesktopCapabilities();
  const engine = signedOutWithoutBackup(bot, state.instances, state.config?.automaticRecovery);
  if (!engine) return null;
  const line = t(aiRunsOnServer(state.config, capabilities) ? "failedReply.signedOutServer" : "failedReply.signedOutHere", { engine: engine.displayName });
  return (
    <div className="w-full px-5" data-sign-in-notice="">
      <div role="status" className={`mb-2 ${NOTICE_LINE} text-ink-secondary`}>
        <span dir="auto" className="min-w-0">{line}</span>
        <span aria-hidden="true">·</span>
        <button type="button" onClick={() => dispatch({ type: "toggleAppSettings", open: true, section: "engines" })}
          className="shrink-0 cursor-pointer rounded-sm font-medium text-ink hover:underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus">
          {t("chat.notice.signIn")}
        </button>
      </div>
    </div>
  );
}
