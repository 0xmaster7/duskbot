// The model menu's "Use this model for" pair and its Thinking pills, alone on a menu surface, for
// scripts/testing/sliding-pills.e2e.test.ts. ?reduced sets the app's own reduced-motion switch.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { setLocale, t } from "../../src/lib/i18n";
import { applySkin } from "../../src/lib/skins";
import { SlidingPills } from "../../src/components/ui/SlidingPills";
import "../../src/styles.css";
import "../../src/styles/motion.css";

setLocale("en");
applySkin("grok");
if (new URLSearchParams(location.search).has("reduced")) document.documentElement.dataset.reducedMotion = "true";

function Fixture() {
  const [scope, setScope] = useState<"bot" | "all">("bot");
  const [level, setLevel] = useState<"low" | "medium" | "high" | undefined>(undefined);
  return (
    <div className="flex min-h-dvh items-start justify-center bg-app p-10 text-ink">
      <div className="menu-surface flex w-[320px] flex-col gap-0.5 p-1.5">
        <span id="scope" className="flex h-6 items-end px-2 pb-0.5 text-[12px] font-medium leading-4 text-ink-tertiary">{t("model.picker.scope")}</span>
        <SlidingPills data-picker-scope aria-labelledby="scope" value={scope} onPick={setScope}
          options={[{ value: "bot", label: t("model.picker.thisBot"), attrs: { "data-scope-pill": "bot" } }, { value: "all", label: t("model.picker.allBots"), attrs: { "data-scope-pill": "all" } }]} />
        <span id="thinking" className="flex h-6 items-end px-2 pb-0.5 text-[12px] font-medium leading-4 text-ink-tertiary">{t("botSettings.simple.thinking")}</span>
        <SlidingPills data-simple-effort aria-labelledby="thinking" value={level} onPick={setLevel} pillClassName="px-1"
          options={(["low", "medium", "high"] as const).map((value) => ({ value, label: value[0]!.toUpperCase() + value.slice(1), attrs: { "data-effort-pill": "" } }))} />
      </div>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
