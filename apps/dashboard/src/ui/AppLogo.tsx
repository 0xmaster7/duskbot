import { useState } from "react";
import { siteIconUrl } from "@/lib/site-icon";
import type { DashApp } from "../data/connectors";

export function AppLogo({ app, size = 40 }: { app: Pick<DashApp, "label" | "icon">; size?: number }) {
  const { icon, label } = app;
  const sources = [icon.image, icon.logo, siteIconUrl(icon.domain)]
    .filter((source): source is string => Boolean(source));
  const [failed, setFailed] = useState<string[]>([]);
  const source = sources.find((candidate) => !failed.includes(candidate));
  const padded = icon.padded || source !== icon.image;
  const inner = padded ? size * (icon.scale ?? 0.684) : size - 2;

  return (
    <span
      aria-hidden="true"
      className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden box-border leading-none${source ? "" : " bg-card-2 text-ink-2 font-medium"}`}
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.28),
        border: "1px solid rgb(255 255 255 / 0.08)",
        background: source ? icon.background ?? (/github/i.test(label) && source === icon.image ? "#f1f1f0" : undefined) : undefined,
        fontSize: Math.round(size * 0.38),
      }}
    >
      {source ? (
        <img
          key={source}
          src={source}
          alt=""
          draggable={false}
          loading="lazy"
          decoding="async"
          width={inner}
          height={inner}
          style={{ width: inner, height: inner }}
          className="object-contain"
          onError={() => setFailed((previous) => [...previous, source])}
        />
      ) : label.slice(0, 1).toUpperCase()}
    </span>
  );
}
