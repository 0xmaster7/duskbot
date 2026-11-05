import { useState } from "react";
import { cn } from "@/lib/cn";

/** One connectable app as the Apps catalog lists it. */
export interface ToolkitCard {
  slug: string;
  label: string;
  blurb: string;
  logo: string | null;
  noAuth?: boolean;
  domain: string | null;
  categories?: string[];
}

/** An app's logo, then its site's favicon, then its initial. */
export function ServiceIcon({ card, className = "size-11" }: { card: Pick<ToolkitCard, "logo" | "domain" | "label">; className?: string }) {
  const [stage, setStage] = useState(card.logo ? 0 : card.domain ? 1 : 2);
  if (stage === 0 && card.logo) {
    return (
      <img
        src={card.logo}
        alt=""
        loading="lazy"
        className={cn("rounded-xl object-contain", className)}
        onError={() => setStage(1)}
      />
    );
  }
  if (stage === 1 && card.domain) {
    return (
      <img
        src={`https://www.google.com/s2/favicons?domain=${card.domain}&sz=64`}
        alt=""
        loading="lazy"
        className={cn("rounded-xl object-contain", className)}
        onError={() => setStage(2)}
      />
    );
  }
  return (
    <div className={cn("flex items-center justify-center rounded-xl bg-raised text-[15px] font-semibold text-ink-secondary", className)}>
      {card.label.slice(0, 1).toUpperCase()}
    </div>
  );
}

const TILE = "relative inline-flex shrink-0 items-center justify-center overflow-hidden border border-ink/[0.08] box-border leading-none";

/** Grok's app tile: a hairline square whose corners grow with it (11px at 40, 16px at 56), the logo on white inside, or
 * the app's initial on a faint fill. */
export function ServiceTile({ card, size = 40, className }: { card: Pick<ToolkitCard, "logo" | "domain" | "label"> & { image?: string }; size?: number; className?: string }) {
  const sources = [card.image, card.logo, card.domain ? `https://www.google.com/s2/favicons?domain=${card.domain}&sz=64` : null]
    .filter((source): source is string => Boolean(source));
  const [failed, setFailed] = useState(0);
  const source = sources[failed];
  const frame = { width: size, height: size, borderRadius: Math.round(size * 0.28) };
  if (!source) {
    return (
      <span aria-hidden="true" className={cn(TILE, "bg-ink/[0.06] font-medium text-ink-secondary", className)} style={{ ...frame, fontSize: Math.round(size * 0.38) }}>
        {card.label.slice(0, 1).toUpperCase()}
      </span>
    );
  }
  const inner = card.image || size <= 24 ? size - 2 : Math.round(size * 0.7);
  return (
    <span aria-hidden="true" className={cn(TILE, "bg-white", className)} style={frame}>
      <img key={source} src={source} alt="" draggable={false} decoding="async" width={inner} height={inner} className="object-contain" onError={() => setFailed((count) => count + 1)} />
    </span>
  );
}
