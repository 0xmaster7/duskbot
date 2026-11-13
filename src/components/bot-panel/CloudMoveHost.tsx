// mounts the Move to Cloud desktop sheet wherever it was asked for, and the watcher that finishes a move after checkout;
// their code loads on first need. on a server's own page the sheet also opens when the person asked for it elsewhere
// (that server's menu on the rail, or the dashboard)
import { useEffect, useState } from "react";
import { closeCloudMove, moveIntended, openCloudMove, readMoveIntent, useCloudMoveOpen } from "@/lib/cloud-move";
import { desktopShowsOtherServer } from "@/lib/other-server";
import { vpsCloudMoveBridge } from "@/lib/vps-cloud-move";
import { lazyScreen } from "../lazy-screens";

const CloudMoveSheet = lazyScreen("CloudMoveSheet", async () => (await import("./CloudMoveSheet")).CloudMoveSheet);
const CloudMoveWatcher = lazyScreen("CloudMoveWatcher", async () => (await import("./CloudMoveSheet")).CloudMoveWatcher);

export function CloudMoveHost() {
  const target = useCloudMoveOpen();
  const [intended, setIntended] = useState(() => moveIntended(readMoveIntent(), Date.now()));
  useEffect(() => { if (!target) setIntended(moveIntended(readMoveIntent(), Date.now())); }, [target]);
  useEffect(() => {
    const bridge = desktopShowsOtherServer() ? vpsCloudMoveBridge() : null;
    if (!bridge?.asked) return;
    let alive = true;
    const check = () => void bridge.asked!().then((yes) => { if (alive && yes) openCloudMove("cloud"); }, () => {});
    check();
    const off = bridge.onShow?.(check);
    return () => { alive = false; off?.(); };
  }, []);
  if (target) return <CloudMoveSheet target={target} onClose={closeCloudMove} />;
  return intended ? <CloudMoveWatcher /> : null;
}
