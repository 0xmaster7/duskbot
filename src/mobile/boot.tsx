import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { productName } from "@/lib/brand";
import { loadPageLanguage } from "@/lib/language-preference";
import { applySkinChoice, readSkinChoice, type SkinChoice } from "@/lib/skins";
import { applyFont, readFont } from "@/lib/fonts";
import { PageBoundary } from "@/components/PageBoundary";
import "@/font-faces";
import "./styles.css";
import "@/styles/overlays.css";
import "@/styles/motion.css";
import "./mobile.css";
import { installHaptics } from "./haptics";
import { PlatformContext, type MobilePlatform } from "./platform";
import { AccountGate } from "./account/AccountGate";
import { ConnectionGate } from "./connection/ConnectionGate";
import { MobileApp } from "./MobileApp";

const PHONE_SKINS: readonly SkinChoice[] = ["system", "grok", "grok-dark"];

/** The phone keeps to Grok's two looks; a desktop skin picked in a shared browser profile falls back to the system's. */
function phoneSkin(params: URLSearchParams): SkinChoice {
  const asked = params.get("scheme");
  if (asked === "dark") return "grok-dark";
  if (asked === "light") return "grok";
  const stored = readSkinChoice();
  return PHONE_SKINS.includes(stored) ? stored : "system";
}

export function mountMobile(platform: MobilePlatform): void {
  const params = new URLSearchParams(location.search);
  if (params.has("frame")) document.documentElement.dataset.phoneFrame = "";
  document.documentElement.dataset.mobileApp = platform.kind;
  applySkinChoice(phoneSkin(params));
  applyFont(readFont());
  const dark = document.documentElement.dataset.skin === "grok-dark";
  platform.setStatusBar?.(dark ? "light" : "dark");
  document.title = productName();
  void Promise.all([loadPageLanguage(), installHaptics(platform)]).then(() => {
    createRoot(document.getElementById("root")!).render(
      <StrictMode>
        <PageBoundary>
          <PlatformContext value={platform}>
            <AccountGate>
              <ConnectionGate forcePair={params.has("pair")}>
                <MobileApp />
              </ConnectionGate>
            </AccountGate>
          </PlatformContext>
        </PageBoundary>
      </StrictMode>,
    );
  });
}
