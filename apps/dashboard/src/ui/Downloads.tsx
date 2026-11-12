import { ArrowUpRight } from "@/icons";
import android from "../art/os/android.svg";
import apple from "../art/os/apple.svg";
import linux from "../art/os/linux.svg";
import windows from "../art/os/windows.svg";
import { track } from "../lib/analytics";
import { detectOs, downloadPage, PLATFORMS, useReleaseState, WAITLIST_URL, type Platform } from "../lib/downloads";
import { cx, Skeleton } from "./kit";

// os marks: gilbarbara/logos, cc0 1.0
const LOGO: Record<Platform, string> = { macos: apple, windows, linux, android, ios: apple };
const NAME: Record<Platform, string> = { macos: "macos", windows: "windows", linux: "linux", android: "android", ios: "ios" };
const NOTE: Record<Platform, string> = { macos: "apple silicon and intel", windows: "windows 10 and 11", linux: "ubuntu 24.04", android: "text your bots", ios: "text your bots" };

function Mark({ platform }: { platform: Platform }) {
  const src = LOGO[platform];
  // apple's mark is one colour, so it takes the ink and stays visible in both themes
  if (src === apple) return <span aria-hidden className="block size-[22px] bg-ink" style={{ maskImage: `url("${src}")`, WebkitMaskImage: `url("${src}")`, maskSize: "contain", WebkitMaskSize: "contain", maskRepeat: "no-repeat", WebkitMaskRepeat: "no-repeat", maskPosition: "center", WebkitMaskPosition: "center" }} />;
  return <img src={src} alt="" width={22} height={22} className="size-[22px] object-contain" draggable={false} />;
}

/** every platform as one row with its mark, the visitor's own first; each row says what the site can give today */
export function Downloads() {
  const release = useReleaseState();
  const detected = detectOs();
  const order = detected === "unknown" ? PLATFORMS : [detected, ...PLATFORMS.filter((p) => p !== detected)];
  return (
    <ul className="flex flex-col gap-1.5" aria-label="downloads">
      {order.map((p) => {
        const yours = p === detected;
        const href = release === "soon" ? WAITLIST_URL : downloadPage(p);
        const action = release === "soon" ? "join waitlist" : p === "android" || p === "ios" ? "get it" : "download";
        return (
          <li key={p}>
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              onClick={() => track({ name: "download_click", props: { platform: p, detected_os: detected } })}
              className={cx("hover-card group flex min-h-14 items-center gap-3.5 rounded-[16px] px-4 py-2.5", yours ? "bg-card-2" : "bg-card")}
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-pop"><Mark platform={p} /></span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-15 font-medium text-ink">{NAME[p]}{yours && <span className="tag !h-5 !px-2 !text-[11px]">yours</span>}</span>
                <span className="block truncate text-13 text-ink-3">{NOTE[p]}</span>
              </span>
              {release === null
                ? <Skeleton className="h-5 w-20" />
                : <span className="inline-flex shrink-0 items-center gap-1 text-14 text-ink-2">{action}<ArrowUpRight size={15} strokeWidth={1.75} aria-hidden /></span>}
            </a>
          </li>
        );
      })}
    </ul>
  );
}
