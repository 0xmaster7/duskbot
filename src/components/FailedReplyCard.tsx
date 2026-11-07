import { createContext, useMemo, useState } from "react";
import { t } from "@/lib/i18n";
import { botEngine, claudeUpdateTarget } from "@/lib/failed-turn";
import { canOfferSignIn, failedReplyDetail, failedReplyKind, failedReplyTitle, mostActionable, trailingRows } from "@/lib/failed-reply";
import { statusActivity } from "@/lib/activity-runs";
import { openPlaceAction, placeRowViewFor, usePlaceSeat, worksOnSimpleLabel } from "@/lib/place-view";
import { useStore, type Message } from "@/state/store";
import { failedTurnCause } from "../../shared/failed-turn";
import { trialCreditKind } from "../../shared/trial-credit";
import { CARD_ACTION, ChatErrorCard } from "./ChatErrorBanner";
import { ClaudeUpdatePrompt } from "./ClaudeUpdatePrompt";
import { useDesktopCapabilities } from "./DesktopCapabilities";
import { useLimitResetContinue } from "./EngineUsage";
import { bugReportFixedText } from "./BugReportNote";
import { openBotSettings } from "./bot-panel/panel-link";

// a card someone closed stays closed for this run of the app; a newer failure is a new card
const dismissed = new Set<string>();

/** The notice rows the card above the composer says, so the transcript leaves them out. */
export const FoldedNoticesContext = createContext<ReadonlySet<string>>(new Set());

export type TrailingRows = ReturnType<typeof trailingRows>;

/** What the card shows for a thread, or nothing while its turn still runs. */
export function useTrailingRows(messages: readonly Message[], live = true): TrailingRows | null {
  return useMemo(() => live ? trailingRows(messages) : null, [messages, live]);
}

export function foldedNoticeIds(rows: TrailingRows | null): ReadonlySet<string> {
  return new Set(rows?.notices.map((m) => m.id) ?? []);
}

const noticeText = (m: Message) => (m.bugReport && bugReportFixedText(m.bugReport)) ?? statusActivity(m)?.text ?? "";
const openEngines = { type: "toggleAppSettings", open: true, section: "engines" } as const;

const TRIAL_LINE = { used_up: "engines.trialCreditUsedUp", ended: "engines.trialCreditEnded", paused: "engines.trialCreditPaused", too_low: "engines.trialCreditTooLow" } as const;

/** grok's failed-reply card: one card just above the composer for every reply the newest turn lost, gone once anything
 * newer lands or it is closed. In a group it names who couldn't reply and says the reason a person can fix. */
export function FailedReplyCard({ rows, group = false, botId: ownBotId, threadId, onRetry }: {
  rows: TrailingRows | null;
  group?: boolean;
  /** a direct chat's bot, whose rows carry no sender */
  botId?: string;
  threadId?: string;
  /** retries the last turn, when it can be retried */
  onRetry?: () => void;
}) {
  const { state, dispatch } = useStore();
  const { capabilities } = useDesktopCapabilities();
  // a test or an older desktop may hand over no host facts
  const platform = capabilities.host?.platform;
  const seat = usePlaceSeat(state.config, platform);
  const [, setClosed] = useState(0);
  const failures = rows?.failures ?? [];
  const notices = (rows?.notices ?? []).filter((m) => !dismissed.has(m.id));
  const items = failures.filter((m) => !dismissed.has(m.id)).map((message) => {
    const id = message.from?.botId ?? ownBotId;
    const bot = state.bots.find((candidate) => candidate.id === id);
    const engine = botEngine(bot, state.instances);
    return { message, bot, engine, kind: failedReplyKind(message.tool!, engine) };
  });
  const lead = mostActionable(items);
  const tool = lead?.message.tool;
  const leadBotId = lead?.bot?.id ?? ownBotId;
  const resume = useLimitResetContinue(leadBotId, threadId, lead?.kind === "usage_limit" ? tool?.limitResetsAt : undefined);
  const signInNotice = notices.find((m) => m.tool?.setup === true);
  const close = () => {
    for (const item of items) dismissed.add(item.message.id);
    for (const notice of notices) dismissed.add(notice.id);
    setClosed((n) => n + 1);
  };
  if (!lead || !tool) {
    // only notices: the newest one is the card, the one way on its pill
    const last = notices.at(-1);
    if (!last) return null;
    const notice = signInNotice ?? last;
    return (
      <div className="mb-2 w-full px-5" data-failed-reply="">
        <ChatErrorCard tone="info" title={noticeText(notice)} onDismiss={close}
          actions={signInNotice && <button type="button" onClick={() => dispatch(openEngines)} className={CARD_ACTION}>{t("chat.notice.signIn")}</button>} />
      </div>
    );
  }

  const onServer = window.ogb?.remoteClient?.active === true || state.config?.cloudHome === true || capabilities.localComputer?.reasonCode === "remote-server";
  const engineName = lead.engine?.displayName ?? t("failedReply.yourAi");
  let detail: string | null = failedReplyDetail(lead.kind, engineName, onServer);
  const actions: Array<{ label: string; onClick: () => void }> = [];
  const retry = onRetry;
  let update = null;
  if (lead.kind === "place" && tool.place && leadBotId) {
    const view = placeRowViewFor(tool.place, seat, worksOnSimpleLabel(lead.bot?.computer, platform));
    detail = view.line;
    const id = view.action?.id;
    if (id === "try-again") { if (retry) actions.push({ label: t("failedReply.tryAgain"), onClick: retry }); }
    else if (id && view.action) actions.push({ label: id === "open-computer-panel" ? t("chat.error.openScreen") : view.action.label, onClick: () => { openPlaceAction(id, { botId: leadBotId, threadId }, dispatch); } });
  } else if (lead.kind === "trial_credit") {
    const credit = trialCreditKind(failedTurnCause(tool.name) ?? "") ?? "used_up";
    detail = t(TRIAL_LINE[credit]);
    if (credit === "paused") { if (retry) actions.push({ label: t("failedReply.tryAgain"), onClick: retry }); }
    else actions.push({ label: t("chat.error.connectOwnAi"), onClick: () => dispatch(openEngines) });
  } else if (lead.kind === "claude_update") {
    const target = claudeUpdateTarget(lead.engine);
    if (target) { detail = null; update = <ClaudeUpdatePrompt instance={target} onRetry={retry} />; }
  } else if (lead.kind === "signed_out") {
    if (canOfferSignIn(lead.kind, lead.engine) || signInNotice) actions.push({ label: t("chat.notice.signIn"), onClick: () => dispatch(openEngines) });
  } else if (lead.kind === "usage_limit") {
    if (resume) actions.push(resume);
  } else if (lead.kind === "no_answer" && !group && tool.rescue) {
    // the first reply never came: what the person can change is the AI, or whose subscription it runs on
    const { rescue } = tool;
    const ai = state.instances.find((instance) => instance.instanceId === rescue.instanceId)?.displayName || rescue.ai;
    detail = t("chat.rescue.over", { bot: lead.bot?.name ?? "", ai });
    actions.push({ label: t("chat.rescue.switchAi"), onClick: () => openBotSettings(dispatch, "model", { botId: rescue.botId }) });
    actions.push({ label: t("chat.rescue.connect"), onClick: () => dispatch(openEngines) });
  } else if (lead.kind !== "credits" && retry) {
    actions.push({ label: t("failedReply.tryAgain"), onClick: retry });
  }
  // a sign-out notice beside a failure for another reason: still one card, its Sign in a pill on it
  if (signInNotice && !actions.some((action) => action.label === t("chat.notice.signIn"))) actions.unshift({ label: t("chat.notice.signIn"), onClick: () => dispatch(openEngines) });
  return (
    <div className="mb-2 w-full px-5" data-failed-reply="">
      <ChatErrorCard
        title={failedReplyTitle(items.map((item) => item.bot?.name ?? item.message.from?.name ?? ""), group)}
        onDismiss={close}
        actions={actions.length > 0 && actions.slice(0, 2).map((action) => (
          <button key={action.label} type="button" onClick={action.onClick} className={CARD_ACTION}>{action.label}</button>
        ))}
      >
        {detail && <p dir="auto" className="text-ink-secondary">{detail}</p>}
        {update}
      </ChatErrorCard>
    </div>
  );
}
