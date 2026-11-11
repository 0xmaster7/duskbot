import { cloneElement, type ReactElement, type ReactNode, type SVGProps } from "react";
import { cn } from "../lib/cn";

/** One of our 16-unit drawings in Gravity UI's style. */
export type Svg = (props: SVGProps<SVGSVGElement>) => ReactElement;

/** A Gravity UI icon's filled paths, each with whether it fills even-odd, on its square grid (16 unless said). */
export type Art = { readonly paths: ReadonlyArray<readonly [d: string, evenOdd: 0 | 1]>; readonly box?: number };

function paint(art: Art): Svg {
  const scale = art.box ? 16 / art.box : 1;
  return (props) => (
    <svg xmlns="http://www.w3.org/2000/svg" width={props.width} height={props.height} fill="none" {...props}>
      {art.paths.map(([d, evenOdd]) => (
        <path key={d} transform={scale === 1 ? undefined : `scale(${scale})`} fill="currentColor" fillRule={evenOdd ? "evenodd" : undefined} clipRule={evenOdd ? "evenodd" : undefined} d={d} />
      ))}
    </svg>
  );
}

export type GlyphProps = Omit<SVGProps<SVGSVGElement>, "ref"> & {
  size?: number | string;
  strokeWidth?: number | string;
  absoluteStrokeWidth?: boolean;
  children?: ReactNode;
};

export type GlyphIcon = ((props: GlyphProps) => ReactElement) & { displayName: string; slug: string; hasSolid: boolean };

const VIEW_WITH_AIR = "-0.5 -0.5 17 17";
const VIEW_HEAVY = "0 0 16 16";
const HEAVY_STROKE = 2.25;

export function glyph(slug: string, outline: Art | Svg, filled?: Art | Svg): GlyphIcon {
  const draw = typeof outline === "function" ? outline : paint(outline);
  const solid = filled == null || typeof filled === "function" ? filled : paint(filled);
  const Glyph = ({ size = 24, strokeWidth, absoluteStrokeWidth: _abs, className, fill, color, style, children, ...rest }: GlyphProps) => {
    const labelled = rest["aria-label"] != null || rest["aria-labelledby"] != null || rest.role === "img";
    const el = ((fill != null && fill !== "none" && solid ? solid : draw)({
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
