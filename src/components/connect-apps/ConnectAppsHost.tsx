import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { lazyScreen, TeamLibraryPanel } from "../lazy-screens";
import { openTemplates } from "../SidebarTemplates";
import { closeConnectApps, useConnectApps } from "./open";

const FIRST_FRAME_WAIT_MS = 600;
const ConnectAppsWindow = lazyScreen("ConnectAppsWindow", async () => {
  const screen = await import("./ConnectAppsWindow");
  await Promise.race([screen.prepareConnectApps(), new Promise((resolve) => setTimeout(resolve, FIRST_FRAME_WAIT_MS))]);
  return screen.ConnectAppsWindow;
});

const hosts: Array<(owns: boolean) => void> = [];
const settle = () => hosts.forEach((own, index) => own(index === 0));

/** Draws the Connect Apps window and the Bot templates it leads to. Mount it once, anywhere under the store; a second
 * host stays empty, so a button that carries one cannot open the window twice. */
export function ConnectAppsHost() {
  const { open, page, nonce } = useConnectApps();
  const [first, setFirst] = useState(false);
  const [templates, setTemplates] = useState(false);
  const back = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    hosts.push(setFirst);
    settle();
    return () => {
      hosts.splice(hosts.indexOf(setFirst), 1);
      settle();
    };
  }, []);
  if (!first) return null;
  return (
    <>
      {open && createPortal(
        <ConnectAppsWindow page={page} nonce={nonce} onClose={closeConnectApps} onTemplates={() => { closeConnectApps(); if (!openTemplates()) setTemplates(true); }} />,
        document.body,
      )}
      {templates && (
        <TeamLibraryPanel returnFocusRef={back} onClose={() => setTemplates(false)} onImported={() => setTemplates(false)} />
      )}
    </>
  );
}

export function preloadConnectApps(): void {
  void ConnectAppsWindow.preload().catch(() => {});
}
