import { useEffect, useRef, useState } from "react";
import { motion, useMotionValue } from "motion/react";
import { t } from "@/lib/i18n";
import { haptic } from "../haptics";
import { useDrag } from "../gesture";
import { projectRelease, rubberband, settleTo } from "../motion";
import { MascotTrio, useScreen } from "./SkyScene";

const PAGES = [
  { title: "mobile.onboarding.page1Title", body: "mobile.onboarding.page1Body" },
  { title: "mobile.onboarding.page2Title", body: "mobile.onboarding.page2Body" },
  { title: "mobile.onboarding.page3Title", body: "mobile.onboarding.page3Body" },
] as const;

/** Three pages that follow the finger: a release lands on the page the flick was heading for, past the ends the track
 * rubber-bands, and each page change ticks. The mascots stay put above the words; only the words move. */
export function IntroPager({ onDone, onPage }: { onDone: () => void; onPage: (page: number) => void }) {
  const { w } = useScreen();
  const [page, setPage] = useState(0);
  const track = useMotionValue(0);
  const areaRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef(0);

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
      <div ref={areaRef} className="relative flex min-h-0 flex-1 flex-col justify-center overflow-hidden" aria-roledescription="carousel" aria-label={t("mobile.onboarding.introLabel")}>
        <MascotTrio className="mb-10" />
        <motion.div className="flex" style={{ x: track, width: w * PAGES.length }}>
          {PAGES.map((item, index) => (
            <section key={item.title} aria-hidden={index !== page} className="px-8 text-center" style={{ width: w }}>
              <h1 className="text-[30px] font-semibold leading-[1.15] tracking-tight text-white">{t(item.title)}</h1>
              <p className="mx-auto mt-3 max-w-[300px] text-[16px] leading-[1.5] text-white/60">{t(item.body)}</p>
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
        <button type="button" onClick={() => (last ? onDone() : goTo(page + 1))} className="mobile-press h-14 rounded-full bg-[#f3f4f8] px-7 text-[17px] font-semibold text-[#121212]">
          {last ? t("mobile.onboarding.start") : t("mobile.onboarding.next")}
        </button>
      </div>
    </div>
  );
}
