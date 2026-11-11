import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { productName } from "@/lib/brand";
import { loadPageLanguage } from "@/lib/language-preference";
import { applySkinChoice, readSkinChoice, THEME_SKINS, type SkinChoice } from "@/lib/skins";
import { applyFont, readFont } from "@/lib/fonts";
import { PageBoundary } from "@/components/PageBoundary";
import "./styles.css";
import "@/styles/overlays.css";
import "@/styles/motion.css";
import "./mobile.css";
import { installHaptics } from "./haptics";
import { followSystemTextSize } from "./text-scale";
import { PlatformContext, type MobilePlatform } from "./platform";
import { AccountGate } from "./account/AccountGate";
import { ConnectionGate } from "./connection/ConnectionGate";
import { MobileApp } from "./MobileApp";

const PHONE_SKINS: readonly SkinChoice[] = ["system", THEME_SKINS.light, THEME_SKINS.dark];

/** The phone keeps to the two default looks; a desktop skin picked in a shared browser profile falls back to the system's. */
function phoneSkin(params: URLSearchParams): SkinChoice {
  const asked = params.get("scheme");
  if (asked === "dark") return THEME_SKINS.dark;
  if (asked === "light") return THEME_SKINS.light;
  const stored = readSkinChoice();
  return PHONE_SKINS.includes(stored) ? stored : "system";
}

export function mountMobile(platform: MobilePlatform): void {
  // the preview page's switches (?frame, ?scheme, ?pair) are for the browser preview: the installed app reads none of them
  const params = new URLSearchParams(platform.native ? "" : location.search);
  if (params.has("frame")) document.documentElement.dataset.phoneFrame = "";
  followSystemTextSize(platform);
  document.documentElement.dataset.mobileApp = platform.kind;
  applySkinChoice(phoneSkin(params));
  applyFont(readFont());
  const dark = document.documentElement.dataset.skin === THEME_SKINS.dark;
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
