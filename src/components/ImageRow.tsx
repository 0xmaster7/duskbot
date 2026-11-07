import { useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { MESSAGE_ROW } from "./MessageActions";
import { AttachmentThumbnail, type PreviewImage } from "./AttachmentPreview";
import { knownImageSize, rememberImageSize } from "@/lib/image-cache";

// grok's image row (MH.plan): one justified row, 192px tall at most, 6px apart; past what fits, up to three tiles
// and the last one carries "+N" for the rest
export const IMAGE_ROW = { height: 192, minHeight: 64, gap: 6, maxTiles: 3, aspect: 4 / 3 } as const;

export interface ImageSize { width: number; height: number }

export interface ImageRowPlan { height: number; widths: number[]; folded: number }

/** grok's gallery width: 80% of the transcript row, at most 560px, and 82px short of the row. */
export function imageRowWidth(rowWidth: number): number {
  return rowWidth <= 0 ? 0 : Math.min(rowWidth * 0.8, 560, Math.max(0, rowWidth - 82));
}

const aspectOf = (size: ImageSize | null) => size && size.width > 0 && size.height > 0 ? size.width / size.height : IMAGE_ROW.aspect;
const ceilingOf = (size: ImageSize | null) => !size || size.height <= 0 ? IMAGE_ROW.height : Math.max(Math.min(size.height, IMAGE_ROW.height), IMAGE_ROW.minHeight);

function occupied(aspects: number[], count: number, height: number, gap: number): number {
  let total = Math.max(0, count - 1) * gap;
  for (let index = 0; index < count; index++) total += Math.round(height * (aspects[index] ?? 0));
  return total;
}

function widthsAt(aspects: number[], count: number, height: number, available: number): number[] {
  return Array.from({ length: count }, (_, index) => Math.min(Math.round(height * (aspects[index] ?? 0)), available));
}

function fittedHeight(aspects: number[], ceilings: number[], count: number, available: number, gap: number): number {
  let height: number = IMAGE_ROW.height;
  let sum = 0;
  for (let index = 0; index < count; index++) {
    height = Math.min(height, ceilings[index] ?? IMAGE_ROW.height);
    sum += aspects[index] ?? 0;
  }
  if (sum <= 0) return 0;
  height = Math.min(height, Math.ceil((available - Math.max(0, count - 1) * gap) / sum));
  while (height > 0 && occupied(aspects, count, height, gap) > available) height--;
  return height;
}

export function planImageRow(sizes: Array<ImageSize | null>, available: number, gap: number = IMAGE_ROW.gap): ImageRowPlan {
  const count = sizes.length;
  if (available <= 0) return { height: IMAGE_ROW.height, widths: [], folded: count };
  const aspects = sizes.map(aspectOf);
  const ceilings = sizes.map(ceilingOf);
  const height = ceilings.reduce((low, value) => Math.min(low, value), IMAGE_ROW.height as number);
  if (occupied(aspects, count, height, gap) <= available) return { height, widths: widthsAt(aspects, count, height, available), folded: 0 };
  for (let tiles = Math.min(IMAGE_ROW.maxTiles, count); tiles > 1; tiles--) {
    const fitted = fittedHeight(aspects, ceilings, tiles, available, gap);
    if (fitted >= IMAGE_ROW.minHeight) return { height: fitted, widths: widthsAt(aspects, tiles, fitted, available), folded: tiles < count ? count - (tiles - 1) : 0 };
  }
  const first = ceilings[0] ?? IMAGE_ROW.height;
  return { height: first, widths: widthsAt(aspects, Math.min(1, count), first, available), folded: count > 1 ? count : 0 };
}

/** Each tile's size as it was when the row first drew it: a size learned on load never re-plans a row on screen. */
function useReservedSizes(images: PreviewImage[]): Array<ImageSize | null> {
  const seen = useRef(new Map<string, ImageSize | null>());
  return images.map((image) => {
    if (!seen.current.has(image.src)) {
      const size = image.size ?? knownImageSize(image.src);
      seen.current.set(image.src, size ? { width: size.w, height: size.h } : null);
    }
    return seen.current.get(image.src)!;
  });
}

function useRowWidth(ref: React.RefObject<HTMLDivElement | null>): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const host = ref.current;
    const row = host?.closest<HTMLElement>(`[${MESSAGE_ROW}]`) ?? host?.parentElement;
    if (!row) return;
    const measure = () => setWidth(row.clientWidth);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

/** The transcript's image row: the person's own images sit at the end with a hairline, a bot's at the start. */
export function ImageRow({ images, align = "start", eager = false, onOpen, className }: {
  images: PreviewImage[];
  align?: "start" | "end";
  eager?: boolean;
  onOpen: (index: number) => void;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const rowWidth = useRowWidth(ref);
  const known = useReservedSizes(images);
  const plan = planImageRow(known, rowWidth > 0 ? imageRowWidth(rowWidth) : 560);
  return (
    <div ref={ref} data-image-row className={cn("flex min-w-0 max-w-full flex-nowrap items-start gap-1.5", align === "end" && "justify-end", className)}>
      {plan.widths.map((width, index) => {
        const image = images[index]!;
        const last = plan.folded > 0 && index === plan.widths.length - 1;
        return (
          <div key={`${index}:${image.src}`} title={image.name} data-image-tile style={{ width, height: plan.height }}
            className={cn("relative shrink-0 overflow-hidden rounded-[12px]", align === "end" && "shadow-[0_0_0_0.5px_rgb(28_28_28/0.08)]")}>
            <AttachmentThumbnail image={image} eager={eager} onPreview={() => onOpen(index)}
              onSize={(size) => rememberImageSize(image.src, size)} fit={known[index] ? "cover" : "contain"}
              label={last ? t("attach.openRemaining", { count: plan.folded }) : t("attach.openFullScreen")}
              className="size-full rounded-none border-0 bg-transparent" />
            {last && (
              <span data-overflow aria-hidden="true" className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/50 text-[22px] font-semibold tracking-[0.01em] text-white/96 tabular-nums">
                +{plan.folded}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
