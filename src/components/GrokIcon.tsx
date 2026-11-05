import type { CSSProperties } from "react";
import { cn } from "../lib/cn";
import { GROK_ICON_FILLED, GROK_ICON_OUTLINE, type GrokIconName } from "./grok-icon-glyphs";
import "../styles/grok-icon.css";

export type { GrokIconName };

export const GROK_ICON_SIZE = { xs: 10, sm: 12, base: 14, lg: 16, xl: 20, "2xl": 24 } as const;

type Props = {
  name: GrokIconName;
  size?: number | keyof typeof GROK_ICON_SIZE;
  variant?: "outline" | "filled";
  className?: string;
  style?: CSSProperties;
  title?: string;
  "aria-label"?: string;
};

export function grokIconChar(name: GrokIconName, variant: "outline" | "filled" = "outline"): string {
  const code = (variant === "filled" ? GROK_ICON_FILLED[name] : undefined) ?? GROK_ICON_OUTLINE[name];
  return String.fromCodePoint(code);
}

export function GrokIcon({ name, size = 16, variant = "outline", className, style, title, "aria-label": label }: Props) {
  const px = typeof size === "number" ? size : GROK_ICON_SIZE[size];
  return (
    <i
      className={cn("grok-icon", className)}
      data-icon-name={name}
      style={{ fontSize: px, width: px, height: px, ...style }}
      title={title}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {grokIconChar(name, variant)}
    </i>
  );
}
