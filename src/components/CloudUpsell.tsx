import { useEffect, useRef, useState } from "react";
import { Cloud, X } from "../icons";
import type { CloudSource } from "@/lib/cloud-plan";
import { firstChatQuiet, firstReplyPending } from "@/lib/corner-popup";
import { cloudUpsellAllowed, markAlwaysOn, sidebarCardSnoozed, snoozeSidebarCard, trackUpsell } from "@/lib/cloud-upsell";
import { MASCOT_INK } from "@/lib/mascot";
import { CLOUD_INTRO, INVESTED_NOTICE, LATE_ROUTINE_NOTICE, launchNotice } from "@/lib/notices";
import { t } from "@/lib/i18n";
import { useStore } from "@/state/store";
import { DuskMark } from "./mascot-view";
import { localDesktopPage } from "./onboarding/WelcomeGate";
import { useCloudPlan } from "./ProIntroduction";
import { deviceWord } from "./vps-link/parts";

/** whether this computer's page may offer dusk cloud at all: someone who could buy it (signed out or free), no organization,
 * not already on a cloud or under a managed policy. null while the plan or organization is still loading. */
export function useCloudUpsell(): { allowed: boolean | null; open: (source: CloudSource) => void } {
  const { state, dispatch } = useStore();
  const plan = useCloudPlan();
  const organization = window.ogb?.organization;
  const [managed, setManaged] = useState<boolean | null>(organization ? null : false);
  useEffect(() => {
    if (!organization) return;
    let active = true, updated = false;
    const accept = (next: Awaited<ReturnType<typeof organization.state>>) => {
      if (active) setManaged(next.status !== "signed-out" && Boolean(next.organization));
    };
    const unsubscribe = organization.onState(next => { updated = true; accept(next); });
    void organization.state().then(next => { if (!updated) accept(next); }).catch(() => {});
    return () => { active = false; unsubscribe(); };
  }, [organization]);
  const here = localDesktopPage() && window.ogb?.remoteClient?.active !== true && Boolean(state.config)
    && !state.config?.cloudHome && !state.config?.managedPolicy;
  const allowed = cloudUpsellAllowed({ here, view: plan?.view ?? null, managed });
  const signedOut = plan?.view.kind === "signed-out";
  const open = (source: CloudSource) => dispatch({ type: "openCloudAdd", source, ...(signedOut ? { signIn: true as const } : {}) });
  return { allowed, open };
}

/** a sleeping pixel bot that looks up while the pointer is on it */
function NappingBot({ size }: { size: number }) {
  const [near, setNear] = useState(false);
  return <span aria-hidden="true" className="shrink-0" onPointerEnter={event => { if (event.pointerType === "mouse") setNear(true); }} onPointerLeave={() => setNear(false)}>
    <DuskMark body="wisp" colour={MASCOT_INK.purple} state="sleeping" size={size} emphasized={near} label={null} />
  </span>;
}

const CLOUD_NOTICES = new Set<string>([INVESTED_NOTICE, CLOUD_INTRO, LATE_ROUTINE_NOTICE]);

/** the small dusk cloud card at the foot of the sidebar: after the first reply, never during setup, and snoozed for some days
 * when closed. A launch that already showed a cloud notice in the corner leaves it out, so the pitch is said once. */
export function SidebarCloudCard() {
  const { state } = useStore();
  const { allowed, open } = useCloudUpsell();
  const [snoozed, setSnoozed] = useState(() => sidebarCardSnoozed());
  const shown = useRef(false);
  const settled = firstReplyPending(state) === false && !firstChatQuiet(state) && !state.welcomeOpen;
  const notice = launchNotice();
  const visible = allowed === true && settled && !snoozed && !(notice && CLOUD_NOTICES.has(notice));
  useEffect(() => {
    if (!visible || shown.current) return;
    shown.current = true;
    trackUpsell("shown", "app_sidebar");
  }, [visible]);
  if (!visible) return null;
  const dismiss = () => { trackUpsell("dismiss", "app_sidebar"); snoozeSidebarCard(); setSnoozed(true); };
  return (
    <section aria-labelledby="sidebar-cloud-title" data-sidebar-cloud-card=""
      className="relative mb-2 rounded-xl bg-composer p-3 text-ink ring-[0.5px] ring-ink/10 [@media(max-height:600px)]:hidden">
      <button type="button" onClick={dismiss} aria-label={t("cloudUpsell.snooze")}
        className="absolute end-1.5 top-1.5 flex size-6 cursor-pointer items-center justify-center rounded-full text-ink/56 transition-[background-color,color] duration-[120ms] ease-[ease] hover:bg-ink/6 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus">
        <X size={13} aria-hidden="true" />
      </button>
      <div className="flex items-center gap-2.5 pe-5">
        <NappingBot size={30} />
        <h2 id="sidebar-cloud-title" className="m-0 min-w-0 text-[12px] font-normal leading-[1.45] text-ink-secondary">{t("cloudUpsell.sidebar", { device: deviceWord() })}</h2>
      </div>
      <button type="button" data-sidebar-cloud-start="" className="ui-button ui-button-primary mt-2.5 w-full justify-center gap-1.5"
        onClick={() => { trackUpsell("click", "app_sidebar"); open("app_sidebar"); }}>
        <Cloud size={13} aria-hidden="true" />{t("rail.buy")}
      </button>
    </section>
  );
}

/** the 24/7 line inside a flow that makes something run on its own (a schedule, an app event, another app sending
 * something) on this computer: it only runs while the computer is awake. Seeing it starts the same cooldown as the
 * new-routine dialog, so that dialog does not repeat it. */
export function AlwaysOnNote({ className }: { className?: string }) {
  const { allowed, open } = useCloudUpsell();
  const { state } = useStore();
  const shown = useRef(false);
  const visible = allowed === true && firstReplyPending(state) === false;
  useEffect(() => {
    if (!visible || shown.current) return;
    shown.current = true;
    markAlwaysOn();
    trackUpsell("shown", "app_always_on");
  }, [visible]);
  if (!visible) return null;
  return (
    <p data-always-on-note="" className={`m-0 flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-[12px] leading-4 text-ink-secondary ${className ?? ""}`}>
      <span>{t("cloudUpsell.alwaysOn", { device: deviceWord() })}</span>
      <button type="button" className="cursor-pointer rounded-[4px] font-medium text-accent-text underline underline-offset-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
        onClick={() => { trackUpsell("click", "app_always_on"); open("app_always_on"); }}>{t("cloudUpsell.alwaysOnAction")}</button>
    </p>
  );
}
