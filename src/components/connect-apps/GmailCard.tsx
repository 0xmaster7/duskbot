import { t } from "@/lib/i18n";
import { GrokIcon } from "../GrokIcon";
import { CancelLink, ConnectedMark } from "./AppRow";
import { PrimaryButton, type Primary } from "./PrimaryButton";
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
  /** how the sign-in goes, said before it starts */
  fine: string | null;
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
  const connecting = action?.busy === true || action?.waiting === true || flow?.step === "authorizing" || flow?.step === "waiting"
    || phase?.kind === "connecting" || phase?.kind === "continue";
  const state: GmailState = connected ? "connected" : line?.tone === "alert" ? "error" : connecting ? "connecting" : "idle";
  return {
    name,
    state,
    action,
    line,
    fine: connected ? null : t(input.via ? "connectApps.gmail.howVia" : "connectApps.gmail.how"),
    ...(input.onOwnKey && input.via && !input.viaSignedIn && !connected ? { onOwnKey: input.onOwnKey } : {}),
  };
}

export function GmailCard({ model }: { model: GmailCardModel }) {
  const { action, line } = model;
  return (
    <section className="ca-card" data-gmail-card="" data-state={model.state} aria-label={t("connectApps.connectApp", { name: model.name })}>
      <div className="ca-card-row ca-gmail-head">
        <p>
          {t("connectApps.gmail.what")}
          {model.fine && <small>{model.fine}{model.onOwnKey && <>{" "}<button type="button" className="ca-link" onClick={model.onOwnKey}>{t("connectApps.signIn.ownKey")}</button></>}</small>}
        </p>
        {action?.onCancel && (action.busy || action.waiting) && <CancelLink onCancel={action.onCancel} />}
        {action ? <PrimaryButton primary={action} /> : model.state === "connected" && <ConnectedMark />}
      </div>
      {line && (
        <p role={line.tone === "alert" ? "alert" : "status"} className="ca-card-row ca-key-line" data-tone={line.tone} data-gmail-line="">
          <GrokIcon name={line.tone === "alert" ? "exclamation-circle" : line.tone === "done" ? "check" : "clock"} size={13} />
          <span>{line.text}</span>
        </p>
      )}
    </section>
  );
}
