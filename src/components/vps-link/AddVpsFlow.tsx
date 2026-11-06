// Add your VPS: one sheet, four screens (copy the line, installing, sign in to your AI, move everything). The sheet opens
// raw; only the move from one screen to the next slides.
import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { EASE, REDUCED } from "@/lib/motion-presets";
import { useVpsLink, vpsStage, type VpsLinkBridge, type VpsLinkView } from "@/lib/vps-link";
import { GrokDialog } from "../ui/GrokDialog";
import { MotionDiv, useMotionReduced } from "../ui/SheetMotion";
import { CommandStage, InstallStage } from "./CommandStage";
import { MoveStage } from "./MoveStage";
import { SignInStage } from "./SignInStage";

const STAGES: ReadonlyArray<[1 | 2 | 3 | 4, LocaleKey]> = [
  [1, "vpsLink.stage.copy"], [2, "vpsLink.stage.install"], [3, "vpsLink.stage.signIn"], [4, "vpsLink.stage.move"],
];
const message = (error: unknown) => String((error as Error)?.message ?? error).replace(/^Error invoking remote method '[^']*':\s*(?:Error:\s*)?/, "");

function StageDots({ at }: { at: 1 | 2 | 3 | 4 }) {
  return (
    <ol aria-label={t("vpsLink.stage.aria")} className="m-0 mb-4 flex list-none items-center gap-1.5 p-0">
      {STAGES.map(([index, key]) => {
        const done = index < at, current = index === at;
        return (
          <li key={index} aria-current={current ? "step" : undefined} className="flex items-center gap-1.5">
            {index > 1 && <span aria-hidden="true" className={cn("h-px w-4", done || current ? "bg-ink/30" : "bg-ink/12")} />}
            <span className={cn("flex h-6 items-center gap-1 rounded-full border px-2 text-[12px] leading-4",
              current ? "border-ink/30 text-ink" : done ? "border-transparent text-ink/68" : "border-transparent text-ink/40")}>
              {done ? <Check size={11} strokeWidth={2.5} aria-hidden="true" /> : <span aria-hidden="true" className="tabular-nums">{index}</span>}
              {t(key)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** The screen for one view; `starting` while main makes the command. */
function StageBody({ at, view, bridge, starting, retry, signedIn, move }: {
  at: 1 | 2 | 3 | 4; view: VpsLinkView; bridge: VpsLinkBridge; starting: boolean; retry: () => void; signedIn: () => void; move: () => void;
}) {
  if (at === 1) return <CommandStage view={view} starting={starting} onRetry={retry} />;
  if (at === 2) return <InstallStage view={view} onRetry={retry} />;
  if (at === 3) return <SignInStage bridge={bridge} server={view.server} onDone={signedIn} />;
  return <MoveStage view={view} bridge={bridge} onMove={move} />;
}

export function AddVpsFlow({ onClose }: { onClose: () => void }) {
  const { view, bridge, set } = useVpsLink();
  const [starting, setStarting] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [error, setError] = useState("");
  const reduced = useMotionReduced();
  const asked = useRef(false);
  // the screen the sheet opened on draws raw, like the sheet itself
  const first = useRef<number | null>(null);

  const run = async (work: () => Promise<VpsLinkView>) => {
    setError("");
    try { set(await work()); }
    catch (cause) { setError(message(cause)); }
  };
  // a fresh sheet asks for a command once; one already under way is picked up where it is
  useEffect(() => {
    if (!bridge || asked.current) return;
    asked.current = true;
    void bridge.state().then((current) => {
      set(current);
      if (current.stage !== "idle") return;
      setStarting(true);
      return run(() => bridge.start()).finally(() => setStarting(false));
    }, (cause) => setError(message(cause)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge]);

  if (!bridge) return null;
  const shown: VpsLinkView = error ? { ...view, error } : view;
  const at = vpsStage(shown, signedIn);
  first.current ??= at;
  const retry = () => {
    setStarting(true);
    void run(async () => { await bridge.reset(); return bridge.start(); }).finally(() => setStarting(false));
  };
  const move = () => void run(() => bridge.move());
  // the next screen slides in from the side as the old one goes at once; under reduced motion it only fades
  const motion = reduced
    ? { initial: { opacity: 0 }, animate: { opacity: 1, transition: REDUCED } }
    : { initial: { opacity: 0, x: 16 }, animate: { opacity: 1, x: 0, transition: { duration: 0.22, ease: EASE.out } } };
  return (
    <GrokDialog title={t("vpsLink.title")} width={560} onClose={onClose} data-panel-modal="add-vps">
      <div data-vps-stage={at} className="flex min-h-[340px] flex-col pb-2">
        <StageDots at={at} />
        <MotionDiv key={at} {...(at === first.current ? {} : motion)}>
          <StageBody at={at} view={shown} bridge={bridge} starting={starting} retry={retry} signedIn={() => setSignedIn(true)} move={move} />
        </MotionDiv>
      </div>
    </GrokDialog>
  );
}
