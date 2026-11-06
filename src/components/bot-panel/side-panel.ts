import { cn } from "@/lib/cn";
import "./panel-phone.css";

export const BOT_PANEL_ID = "bot-panel";

export const sidePanelCls = (overlay: boolean, simple = false) => cn(
  "absolute inset-0 z-40 flex h-full min-w-0 flex-col outline-none focus-visible:outline-none",
  // the docked panel draws its own 0.5px edge above its content (PanelShell), unbroken by the sticky tabs
  simple && !overlay ? "bg-app" : "border-l border-hairline/40 bg-panel",
  // on a phone the panel is its own full-screen sheet: Grok's grey page under stacks of white segments, no edge
  simple && "side-panel max-md:border-l-0",
  overlay
    ? cn("md:inset-auto md:right-0 md:top-0 md:bottom-0 md:shadow-2xl", simple ? "md:w-[320px]" : "md:w-[min(420px,42vw)]")
    : cn("md:static md:z-auto md:shrink-0", simple ? "md:w-[320px]" : "md:w-[min(420px,42vw)]"),
);
