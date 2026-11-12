import { PixelIcon, type PixelIconName } from "./PixelIcon";

export type NoticeTone = "info" | "warning" | "danger" | "success";

/** calm by default: info and a heads-up share the quiet info mark; only an error is red */
const PICTURE: Record<NoticeTone, PixelIconName> = { info: "info", warning: "info", danger: "stop", success: "check" };

/** The one small pixel picture that carries a notice's tone, or what it is about; the words stay ink. */
export function NoticeGlyph({ tone, icon }: { tone: NoticeTone; icon?: PixelIconName }) {
  return (
    <span aria-hidden="true" className="flex size-5 shrink-0 items-center justify-center">
      <PixelIcon name={icon ?? PICTURE[tone]} size={20} />
    </span>
  );
}
