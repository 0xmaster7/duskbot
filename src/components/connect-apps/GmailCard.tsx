import { t } from "@/lib/i18n";
import { ConnectBlock } from "./ConnectBlock";
import type { Primary } from "./PrimaryButton";
import { viaLine } from "./ComposioKeyStep";
import type { ConnectorPhase } from "./use-connectors";
import type { ViaFlow } from "./via-flow";

export type GmailState = "idle" | "connecting" | "connected" | "error";

export interface GmailCardModel {
  name: string;
  state: GmailState;
  /** the one button on the card, null once there is nothing left to click */
  action: Primary | null;
  line: { text: string; tone: "status" | "alert" | "done" } | null;
  /** what signing in looks like: Composio's page first where the sign-in goes through Composio Connect */
  note: string | null;
  onOwnKey?: () => void;
}

export interface GmailInput {
  name: string;
  /** the app page's main action for this app, worked out the way every Composio app's is */
  primary: Primary | null;
  connected: boolean;
  /** signing in goes through Composio Connect: Composio first, then Google */
  via: boolean;
  viaSignedIn: boolean;
  flow: ViaFlow | undefined;
  phase: ConnectorPhase | null;
  onOwnKey?: () => void;
}

/** Gmail's connect, on one card: the same steps and server calls as any Composio app, said in plain words, with the
 * one button that does the next thing. */
export function gmailCard(input: GmailInput): GmailCardModel {
  const { name, flow, phase } = input;
  let action = input.primary;
  // the first click signs in to Composio; to the person it is still connecting Gmail
  if (action?.signIn && !action.busy && !flow) action = { ...action, label: t("connectApps.connectApp", { name }) };
  const connected = input.connected || flow?.step === "done";
  let line = input.via ? viaLine(flow, name) : null;
  if (connected) line = { text: t("connectApps.gmail.connected"), tone: "done" };
  else if (!line && input.via && input.viaSignedIn && !flow) line = { text: t("connectApps.gmail.next"), tone: "status" };
  else if (!line && phase?.kind === "continue") line = { text: t("connectApps.gmail.waiting"), tone: "status" };
  else if (!line && phase?.kind === "reconnect") line = { text: t("connectApps.gmail.reconnect"), tone: "alert" };
  else if (!line && phase?.kind === "failed") line = viaLine({ step: "failed", why: phase.why, ...(phase.message ? { message: phase.message } : {}) }, name);
  const connecting = action?.busy === true || action?.waiting === true || flow?.step === "authorizing" || flow?.step === "waiting"
    || phase?.kind === "connecting" || phase?.kind === "continue";
  const state: GmailState = connected ? "connected" : line?.tone === "alert" ? "error" : connecting ? "connecting" : "idle";
  return {
    name,
    state,
    action,
    line,
    note: connected ? null : t(input.via && !input.viaSignedIn ? "connectApps.gmail.whatVia" : "connectApps.gmail.what"),
    ...(input.onOwnKey && input.via && !input.viaSignedIn && !connected ? { onOwnKey: input.onOwnKey } : {}),
  };
}

export function GmailCard({ model }: { model: GmailCardModel }) {
  const own = model.onOwnKey;
  return (
    <ConnectBlock data-gmail-card="" data-state={model.state} aria-label={t("connectApps.connectApp", { name: model.name })}
      note={model.note}
      primary={model.action} connected={model.state === "connected"} line={model.line} lineMarker="data-gmail-line">
      {own && <button type="button" className="ca-link ca-connect-alt" onClick={own}>{t("connectApps.signIn.ownKey")}</button>}
    </ConnectBlock>
  );
}
