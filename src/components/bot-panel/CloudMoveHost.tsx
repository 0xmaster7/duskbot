// mounts the Move to Cloud desktop sheet wherever it was asked for, and the watcher that finishes a move after checkout;
// their code loads on first need
import { useEffect, useState } from "react";
import { closeCloudMove, moveIntended, readMoveIntent, useCloudMoveOpen } from "@/lib/cloud-move";
import { lazyScreen } from "../lazy-screens";

const CloudMoveSheet = lazyScreen("CloudMoveSheet", async () => (await import("./CloudMoveSheet")).CloudMoveSheet);
const CloudMoveWatcher = lazyScreen("CloudMoveWatcher", async () => (await import("./CloudMoveSheet")).CloudMoveWatcher);

export function CloudMoveHost() {
  const target = useCloudMoveOpen();
  const [intended, setIntended] = useState(() => moveIntended(readMoveIntent(), Date.now()));
  useEffect(() => { if (!target) setIntended(moveIntended(readMoveIntent(), Date.now())); }, [target]);
  if (target) return <CloudMoveSheet target={target} onClose={closeCloudMove} />;
  return intended ? <CloudMoveWatcher /> : null;
}
