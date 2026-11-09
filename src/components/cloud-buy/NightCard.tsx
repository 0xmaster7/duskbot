// Dusk Cloud's night card, cut like a linocut: the three bots ride a cloud under the moon while this computer's
// laptop sleeps on the hill.
import { lazy, Suspense, useRef, type ComponentType, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { useLiveMotion } from "./live-motion";

const Scene = lazy<ComponentType<{ moving: boolean }>>(() => import("./NightCardScene").then((module) => ({ default: module.NightCardScene }), () => ({ default: () => null })));

/** `children` is the card's text, over the empty sky on the left; the scene keeps right, clear of a close button in the corner.
 * `small` is the Cloud Pro popup's. */
export function NightCard({ small = false, children }: { small?: boolean; children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const moving = useLiveMotion(root);
  return <div ref={root} data-night-card="" data-paused={moving ? undefined : ""}
    className={cn("cloud-night relative isolate overflow-hidden rounded-[12px]", small ? "h-[92px]" : "h-[120px]")}>
    <Suspense fallback={null}><Scene moving={moving} /></Suspense>
    <div className={cn("relative z-10 flex h-full flex-col justify-center", small ? "px-5" : "px-6")}>{children}</div>
  </div>;
}
