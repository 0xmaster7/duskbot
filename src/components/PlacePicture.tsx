import { useRef, useState } from "react";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { BANNER_ACCEPT, bannerSrc, prepareBanner, removeBanner, uploadBanner, type BannerProblem, type BannerSummary } from "@/lib/place-banner";
import { NavRow } from "./ListRows";

const PROBLEM: Readonly<Record<BannerProblem | "animated" | "failed", LocaleKey>> = {
  format: "placeLook.imageFormat", read: "placeLook.imageRead", size: "placeLook.imageSize", animated: "placeLook.imageMoving", failed: "placeLook.imageFailed",
};

/** The sidebar's picture, a row of its own: choose one (shrunk and cleaned here, checked again by the server), change
 * it, or remove it. Whoever may change this place's settings may; everyone else sees it. */
export function PlacePicture({ banner, canChange, subtitle }: { banner: BannerSummary | null; canChange: boolean; subtitle?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<LocaleKey | null>(null);
  const src = bannerSrc(banner);
  const run = async (work: () => Promise<{ ok: true } | { ok: false; problem: keyof typeof PROBLEM }>) => {
    setBusy(true); setProblem(null);
    const answer = await Promise.resolve().then(work).catch(() => ({ ok: false as const, problem: "failed" as const }));
    setBusy(false);
    if (!answer.ok) setProblem(PROBLEM[answer.problem]);
  };
  const chosen = (file: File | undefined) => {
    if (input.current) input.current.value = "";
    if (!file || !canChange) return;
    void run(async () => {
      const prepared = await prepareBanner(file);
      return prepared.ok ? uploadBanner(prepared.blob) : prepared;
    });
  };
  const message = problem ? <p role="alert" className="text-danger">{t(problem)}</p>
    : canChange ? null : <p className="text-ink-secondary">{t("placeLook.imageAdmins")}</p>;
  return <div data-place-picture={src ? "set" : "none"} className="flex flex-col">
    <NavRow drill={false} disabled={!canChange || busy} title={t("placeLook.sidebarPicture")} hint={problem ? undefined : subtitle}
      value={busy ? t("placeLook.imageSaving") : t(src ? "placeLook.changeImage" : "placeLook.useImage")} onClick={() => input.current?.click()} />
    {src && <NavRow drill={false} disabled={!canChange || busy} title={t("placeLook.removeImage")} onClick={() => void run(removeBanner)} />}
    {message && <div className="px-2 pb-1.5 text-[12px]">{message}</div>}
    <input ref={input} type="file" accept={BANNER_ACCEPT} hidden data-place-picture-input onChange={(event) => chosen(event.target.files?.[0])} />
  </div>;
}
