import { useEffect, useRef, useState } from "react";
import { motion, useMotionValue, useMotionValueEvent, type MotionValue } from "motion/react";
import { Cloud, Laptop, Smartphone } from "lucide-react";
import { t } from "@/lib/i18n";
import { haptic } from "../haptics";
import { useDrag } from "../gesture";
import { projectRelease, rubberband, settleTo } from "../motion";
import { useScreen } from "./SkyScene";

const PAGES = [
  { title: "mobile.onboarding.page1Title", body: "mobile.onboarding.page1Body" },
  { title: "mobile.onboarding.page2Title", body: "mobile.onboarding.page2Body" },
  { title: "mobile.onboarding.page3Title", body: "mobile.onboarding.page3Body" },
] as const;

/** The three places a bot lives, drawn on the second page between the mascots: this phone, the Mac, the cloud. */
export function SyncGlyphs({ shown }: { shown: boolean }) {
  const chip = "absolute flex size-14 items-center justify-center rounded-full bg-white/[0.07] text-white/80 ring-1 ring-white/10 backdrop-blur-sm";
  return (
    <motion.div aria-hidden className="pointer-events-none absolute inset-0" data-scan-hide initial={false} animate={{ opacity: shown ? 1 : 0 }} transition={{ duration: 0.22 }}>
      <svg className="absolute inset-x-0 top-[14vh] h-[30vh] w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
        <path d="M14 70 Q50 10 86 70" fill="none" stroke="rgb(255 255 255 / .16)" strokeWidth=".5" strokeDasharray="1.6 1.6" vectorEffect="non-scaling-stroke" />
      </svg>
      <span className={chip} style={{ left: "calc(14% - 28px)", top: "calc(14vh + 21vh - 28px)" }}><Smartphone size={22} strokeWidth={1.6} /></span>
      <span className={chip} style={{ left: "calc(50% - 28px)", top: "calc(14vh + 3vh - 28px)" }}><Cloud size={22} strokeWidth={1.6} /></span>
      <span className={chip} style={{ left: "calc(86% - 28px)", top: "calc(14vh + 21vh - 28px)" }}><Laptop size={22} strokeWidth={1.6} /></span>
    </motion.div>
  );
}

/** Three pages that follow the finger: a release lands on the page the flick was heading for, past the ends the track
 * rubber-bands, and each page change ticks. `drag` carries the live offset to the sky so the mascots parallax with it. */
export function IntroPager({ onDone, onPage, drag }: { onDone: () => void; onPage: (page: number) => void; drag: MotionValue<number> }) {
  const { w } = useScreen();
  const [page, setPage] = useState(0);
  const track = useMotionValue(0);
  const areaRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef(0);

  useMotionValueEvent(track, "change", (value) => drag.set(value + pageRef.current * w));

  const goTo = (next: number, velocity = 0) => {
    const clamped = Math.max(0, Math.min(PAGES.length - 1, next));
    if (clamped !== pageRef.current) haptic("selection");
    pageRef.current = clamped;
    setPage(clamped);
    onPage(clamped);
    settleTo(track, -clamped * w, velocity);
  };

  useEffect(() => { track.set(-pageRef.current * w); }, [w]); // eslint-disable-line react-hooks/exhaustive-deps

  useDrag(areaRef, {
    axis: "x",
    claim: () => true,
    onMove: (s) => {
      const base = -pageRef.current * w;
      const raw = base + s.dx;
      const min = -(PAGES.length - 1) * w;
      track.set(raw > 0 ? rubberband(raw, w * 0.25) : raw < min ? min + rubberband(raw - min, w * 0.25) : raw);
    },
    onEnd: (s) => {
      const landing = projectRelease(track.get(), s.vx, 0.995);
      goTo(Math.round(-landing / w), s.vx);
    },
    onCancel: () => goTo(pageRef.current),
  });

  const last = page === PAGES.length - 1;
  return (
    <div className="absolute inset-0 flex flex-col">
      <div className="flex justify-end px-5 pt-[calc(var(--m-safe-top)+10px)]">
        <button type="button" onClick={onDone} className="mobile-press h-11 rounded-full px-4 text-[15px] font-medium text-white/70">{t("mobile.onboarding.skip")}</button>
      </div>
      <div ref={areaRef} className="relative min-h-0 flex-1 overflow-hidden" aria-roledescription="carousel" aria-label={t("mobile.onboarding.introLabel")}>
        <motion.div className="absolute bottom-0 left-0 flex h-full" style={{ x: track, width: w * PAGES.length }}>
          {PAGES.map((item, index) => (
            <section key={item.title} aria-hidden={index !== page} className="flex h-full flex-col justify-end px-7 pb-8" style={{ width: w }}>
              <h1 className="text-[32px] font-semibold leading-[1.12] tracking-tight text-white">{t(item.title)}</h1>
              <p className="mt-3 max-w-[320px] text-[17px] leading-[1.5] text-white/65">{t(item.body)}</p>
            </section>
          ))}
        </motion.div>
      </div>
      <div className="flex items-center gap-4 px-7 pb-[calc(var(--m-safe-bottom)+20px)]">
        <div className="flex flex-1 items-center gap-2" role="tablist" aria-label={t("mobile.onboarding.pages")}>
          {PAGES.map((item, index) => (
            <button key={item.title} type="button" role="tab" aria-selected={index === page} aria-label={t("mobile.onboarding.pageN", { n: index + 1 })} onClick={() => goTo(index)} className="flex size-11 items-center justify-center -mx-3.5">
              <span className="block h-2 w-2 origin-left rounded-full bg-white transition-[opacity,scale] duration-200" style={{ opacity: index === page ? 1 : 0.3, scale: index === page ? "2.4 1" : "1 1" }} />
            </button>
          ))}
        </div>
        <button type="button" onClick={() => (last ? onDone() : goTo(page + 1))} className="mobile-press h-14 rounded-full bg-[#f3f4f8] px-7 text-[17px] font-semibold text-[#0b0d14]">
          {last ? t("mobile.onboarding.start") : t("mobile.onboarding.next")}
        </button>
      </div>
    </div>
  );
}
