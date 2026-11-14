// The model picker's "Not connected" rows: one compact row per AI that isn't connected here yet. A press runs that AI's
// connect right under its row, the same connect the Connect an AI cards run (ConnectPanel); an AI with no sign-in of its
// own (an API key, a local endpoint) goes to the model directory instead.
import { useId } from "react";
import { Check } from "../../icons";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { InstanceInfo } from "@/state/store";
import { InstanceProviderMark } from "../ProviderIcons";
import { MENU_GUTTER, MENU_LABEL, SIMPLE_MENU_META, SIMPLE_MENU_ROW } from "../menu-recipe";
import { ConnectPanel, type ConnectFlowHandle } from "../onboarding/SignInPill";

export interface PickerConnectRow {
  /** The row's key: the AI card's id, or the instance's for an account no card stands for. */
  key: string;
  name: string;
  instance: InstanceInfo;
  /** The instances a connect may use, best first. */
  candidates: string[];
  /** Connects in the app (a browser sign-in); otherwise the row opens the model directory. */
  inApp: boolean;
  /** Set up here before and signed out since, or never set up. */
  state: "signIn" | "setUp" | "new";
}

export function PickerConnect({ rows, flow, active, onPress, onTrouble }: {
  rows: readonly PickerConnectRow[];
  flow: ConnectFlowHandle;
  /** The row whose connect is running. */
  active: string | null;
  onPress: (row: PickerConnectRow) => void;
  onTrouble: () => void;
}) {
  const labelId = useId();
  if (rows.length === 0) return null;
  return (
    <div role="group" aria-labelledby={labelId} data-picker-not-connected="" className="mt-1 flex flex-col gap-0.5">
      <div id={labelId} className={MENU_LABEL}>{t("model.picker.notConnected")}</div>
      {rows.map((row) => {
        const open = row.key === active;
        const connected = open && flow.state.stage === "connected";
        const note = row.state === "signIn" ? t("model.picker.needsSignIn") : row.state === "setUp" ? t("model.picker.needsSetup") : null;
        return (
          <div key={row.key} className="flex flex-col">
            <button type="button" data-menu-row data-picker-connect={row.key} tabIndex={-1}
              aria-expanded={row.inApp ? open : undefined} aria-label={[t("model.picker.connectName", { name: row.name }), connected ? t("funnel.ai.ready") : note].filter(Boolean).join(" · ")}
              onClick={() => onPress(row)} className={SIMPLE_MENU_ROW}>
              <span className={MENU_GUTTER}><InstanceProviderMark instance={row.instance} size={14} subtle /></span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate">{row.name}</span>
                {note && !connected && <span className={SIMPLE_MENU_META}>{note}</span>}
              </span>
              {connected ? (
                <span className="flex shrink-0 items-center gap-1 text-[12px] leading-4 text-success">
                  <Check size={12} strokeWidth={2.5} aria-hidden="true" />{t("funnel.ai.ready")}
                </span>
              ) : (
                <span aria-hidden="true" className={cn("flex h-6 shrink-0 items-center rounded-full px-2.5 text-[12px] leading-4 transition-colors motion-reduce:transition-none",
                  open ? "bg-ink/[0.1] text-ink" : "bg-ink/[0.06] text-ink-secondary group-hover:text-ink group-focus:text-ink")}>
                  {t("model.picker.connect")}
                </span>
              )}
            </button>
            {open && row.inApp && (
              <div data-picker-connect-panel={row.key} className="mx-1 mb-1 mt-0.5 rounded-xl bg-ink/[0.035] px-2 py-3">
                <ConnectPanel flow={flow} name={row.name} driverKind={row.instance.driverKind} onTrouble={onTrouble} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
