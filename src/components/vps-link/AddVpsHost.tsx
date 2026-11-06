// mounts the Add your VPS sheet wherever it was asked for (Settings, the Transfer pane); its code loads on first open
import { closeAddVps, useAddVpsOpen, vpsLinkAvailable } from "@/lib/vps-link";
import { lazyScreen } from "../lazy-screens";

const AddVpsFlow = lazyScreen("AddVpsFlow", async () => (await import("./AddVpsFlow")).AddVpsFlow);

export function AddVpsHost() {
  const open = useAddVpsOpen();
  if (!open || !vpsLinkAvailable()) return null;
  return <AddVpsFlow onClose={closeAddVps} />;
}
