import { useEffect, useState } from "react";

import type { CloudAccountState, CloudPlanSnapshot } from "../../../electron/cloud-account.mjs";
import type { KeepHereState } from "../../../electron/cloud-send.mjs";
import { boatCloudHint, boatCloudOnCloud, boatCloudOnComputer, type BoatCloudView } from "@/lib/boat-cloud";
import { ipcErrorText } from "@/lib/cloud-send";
import { t } from "@/lib/i18n";
import { useStore } from "@/state/store";
import { ConfirmDialog } from "../ConfirmDialog";
import { ItemRow, NavRow } from "../ListRows";
import { useCloudSendNotice } from "../CloudSendStrip";

/** The bridges the row runs on: only in the desktop app, and only where main offers the one-time move's switch. */
function bridges(cloudPage: boolean) {
  const ogb = typeof window === "undefined" || window.ogb?.remoteClient?.active ? undefined : window.ogb;
  const send = ogb?.cloudSendPage?.keepHere && ogb.cloudSendPage.setKeepHere ? ogb.cloudSendPage : undefined;
  const account = cloudPage ? undefined : ogb?.cloudAccount;
  const plan = cloudPage ? ogb?.cloudPlan : undefined;
  return send && (account || plan) ? { send, account, plan } : null;
}

/**
 * The works-on choices' Boat cloud row: where the person's Boat cloud stands, and choosing it runs that step's own flow,
 * never the bot's place. No Cloud: Add a Cloud. Ready: this computer's bots move there (the one-time move, once the person
 * confirms), or it opens once they are there. On its own page: they move back. Null outside the desktop app.
 */
export function useBoatCloud() {
  const { state, dispatch } = useStore();
  const cloudPage = state.config?.cloudHome === true;
  const bridge = bridges(cloudPage);
  const [account, setAccount] = useState<CloudAccountState | null>(null);
  const [plan, setPlan] = useState<CloudPlanSnapshot | null>(null);
  const [keep, setKeep] = useState<KeepHereState | null>(null);
  const [notice] = useCloudSendNotice(bridge?.send);
  const [confirming, setConfirming] = useState<"move" | "back" | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const accountBridge = bridge?.account, planBridge = bridge?.plan, send = bridge?.send;
  useEffect(() => {
    if (!accountBridge) return;
    let alive = true, updated = false;
    const unsubscribe = accountBridge.onState((next) => { updated = true; if (alive) setAccount(next); });
    void accountBridge.state().then((next) => { if (alive && !updated) setAccount(next); }).catch(() => {});
    return () => { alive = false; unsubscribe(); };
  }, [accountBridge]);
  // the plan and the switch have no change event of their own: read again whenever the move's line or the session moves
  useEffect(() => {
    if (!planBridge) return;
    let alive = true;
    void planBridge.state().then((next) => { if (alive) setPlan(next); }).catch(() => {});
    return () => { alive = false; };
  }, [planBridge, notice]);
  useEffect(() => {
    if (!send?.keepHere) return;
    let alive = true;
    void send.keepHere().then((next) => { if (alive) setKeep(next); }).catch(() => {});
    return () => { alive = false; };
  }, [send, notice, account]);

  const view: BoatCloudView | null = !bridge ? null
    : cloudPage ? boatCloudOnCloud(plan, keep) : boatCloudOnComputer(account, keep, notice?.move ?? null);

  const run = (work: () => Promise<unknown>, after?: () => void) => {
    if (busy) return;
    setBusy(true); setFailed(null);
    void work().then(() => { setBusy(false); after?.(); }, (cause: unknown) => { setBusy(false); setFailed(ipcErrorText(cause) ?? t("place.boat.failed")); });
  };
  const switchKeep = (on: boolean) => run(async () => setKeep(await send!.setKeepHere!(on)), () => setConfirming(null));

  const choose = () => {
    if (!view?.acts || busy) return;
    setFailed(null);
    switch (view.step) {
      case "get":
      case "finish": dispatch({ type: "openCloudAdd", source: "app_menu" }); return;
      case "manage": if (accountBridge) run(() => accountBridge.openDashboard()); return;
      case "open": if (accountBridge) run(() => accountBridge.connectHome()); return;
      case "move": setConfirming("move"); return;
      case "back": setConfirming("back"); return;
    }
  };

  const place = view?.name ?? t("place.boat.title");
  const error = failed && <p role="alert" className="mt-2 text-[13px] text-danger">{failed}</p>;
  const dialog = bridge && (
    <ConfirmDialog
      open={confirming !== null}
      title={confirming === "back" ? t("place.boat.backTitle") : t("place.boat.moveTitle", { place })}
      body={<>{confirming === "back" ? t("place.boat.backBody") : t("place.boat.moveBody", { place })}{error}</>}
      confirmLabel={confirming === "back" ? t("place.boat.backConfirm") : t("place.boat.moveConfirm")}
      cancelLabel={t("common.cancel")}
      tone="neutral"
      pending={busy}
      onCancel={() => { if (!busy) { setConfirming(null); setFailed(null); } }}
      onConfirm={() => switchKeep(confirming === "back")}
    />
  );

  return view && {
    view,
    label: t("place.boat.title"),
    // a failure outside the confirm (Open, Manage) says why on the row itself
    hint: failed && confirming === null ? failed : boatCloudHint(view.step),
    busy,
    choose,
    dialog,
  };
}

export type BoatCloudRow = NonNullable<ReturnType<typeof useBoatCloud>>;

/** The row under the works-on choices, apart from them: it never changes where the bot works. A step that does nothing
 * yet (setting up, moving) is a plain row with where things stand. */
export function BoatCloudListRow({ boat }: { boat: BoatCloudRow }) {
  if (!boat.view.acts) return <ItemRow data-panel-row="boat" title={boat.label} hint={boat.hint} />;
  return <NavRow data-panel-row="boat" title={boat.label} hint={boat.hint} disabled={boat.busy} onClick={boat.choose} />;
}
