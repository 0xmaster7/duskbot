import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode, type SVGProps } from "react";
import { cn } from "../lib/cn";

/** A 16-unit icon drawing: Gravity UI's (MIT) or one of ours in its style. */
export type Svg = (props: SVGProps<SVGSVGElement>) => ReactElement;

export type GlyphProps = Omit<SVGProps<SVGSVGElement>, "ref"> & {
  size?: number | string;
  strokeWidth?: number | string;
  absoluteStrokeWidth?: boolean;
  children?: ReactNode;
};

export type GlyphIcon = ((props: GlyphProps) => ReactElement) & { displayName: string; slug: string; hasSolid: boolean };

type Part = ReactElement<{ clipPath?: string; children?: ReactNode }>;

/** a few gravity drawings clip to their own 16x16 box through a page-global id="a"; the clip changes nothing, the shared id can */
function withoutViewboxClip(el: ReactElement<{ children?: ReactNode }>): ReactElement<{ children?: ReactNode }> {
  const parts = Children.toArray(el.props.children).filter(isValidElement) as Part[];
  if (!parts.some((part) => part.type === "defs")) return el;
  const kept = parts.filter((part) => part.type !== "defs").map((part) => (part.type === "g" && part.props.clipPath ? part.props.children : part));
  return cloneElement(el, undefined, ...kept);
}

const VIEW_WITH_AIR = "-0.5 -0.5 17 17";
const VIEW_HEAVY = "0 0 16 16";
const HEAVY_STROKE = 2.25;

export function glyph(slug: string, draw: Svg, solid?: Svg): GlyphIcon {
  const Glyph = ({ size = 24, strokeWidth, absoluteStrokeWidth: _abs, className, fill, color, style, children, ...rest }: GlyphProps) => {
    const labelled = rest["aria-label"] != null || rest["aria-labelledby"] != null || rest.role === "img";
    const filled = fill != null && fill !== "none";
    const el = withoutViewboxClip((filled && solid ? solid : draw)({
      className: cn("gi", `gi-${slug}`, className),
      ...rest,
      width: size,
      height: size,
      viewBox: Number(strokeWidth) >= HEAVY_STROKE ? VIEW_HEAVY : VIEW_WITH_AIR,
      style: color ? { color, ...style } : style,
      "aria-hidden": labelled ? rest["aria-hidden"] : (rest["aria-hidden"] ?? true),
    }) as ReactElement<{ children?: ReactNode }>);
    return children ? cloneElement(el, undefined, children, el.props.children) : el;
  };
  Glyph.displayName = slug;
  Glyph.slug = slug;
  Glyph.hasSolid = solid != null;
  return Glyph as GlyphIcon;
}
