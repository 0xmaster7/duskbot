// browser logos: gilbarbara/logos (CC0 1.0), drawn at 64px
import android from "../art/os/android.svg";
import apple from "../art/os/apple.svg";
import linux from "../art/os/linux.svg";
import windows from "../art/os/windows.svg";
import arc from "../art/browsers/arc.png";
import brave from "../art/browsers/brave.png";
import chrome from "../art/browsers/chrome.png";
import edge from "../art/browsers/edge.png";
import firefox from "../art/browsers/firefox.png";
import safari from "../art/browsers/safari.png";

/** a country's flag from its two-letter code; empty for anything else */
export function flagOf(code: string | null | undefined) {
  if (!code || !/^[A-Za-z]{2}$/.test(code)) return "";
  return String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1a5 + c.charCodeAt(0)));
}
export const deviceEmoji = (device: string | null | undefined) => device === "mobile" ? "📱" : device === "tablet" ? "📱" : "🖥️";

const OS: Record<string, { src: string; label: string }> = { mac: { src: apple, label: "macos" }, ios: { src: apple, label: "ios" }, windows: { src: windows, label: "windows" },
  linux: { src: linux, label: "linux" }, android: { src: android, label: "android" } };
const BROWSER: Record<string, string> = { chrome, safari, firefox, edge, arc, brave };

/** an os or browser name with its logo, when we have one */
export function Platform({ kind, value }: { kind: "os" | "browser"; value: string | null | undefined }) {
  if (!value || value === "other") return null;
  const src = kind === "os" ? OS[value]?.src : BROWSER[value];
  const label = kind === "os" ? OS[value]?.label ?? value : value;
  return (
    <span className="inline-flex items-center gap-1.5">
      {src === apple ? <span aria-hidden className="block size-3.5 shrink-0 bg-ink-2" style={{ maskImage: `url("${src}")`, WebkitMaskImage: `url("${src}")`, maskSize: "contain", WebkitMaskSize: "contain", maskRepeat: "no-repeat", WebkitMaskRepeat: "no-repeat", maskPosition: "center", WebkitMaskPosition: "center" }} />
        : src && <img src={src} alt="" width={14} height={14} className="size-3.5 shrink-0 object-contain" />}
      {label}
    </span>
  );
}
