import { createRoot } from "react-dom/client";
import { ConnectAppsHost, openConnectApps } from "../../src/components/connect-apps";
import { StoreProvider } from "../../src/state/store";
import { applySkin, readSkin } from "../../src/lib/skins";
import "../../src/styles.css";

applySkin(readSkin());
createRoot(document.getElementById("root")!).render(<StoreProvider><ConnectAppsHost /></StoreProvider>);
openConnectApps();
