import type { CloudAccountState, CloudPlanSnapshot } from "../../electron/cloud-account.mjs";
import type { KeepHereState } from "../../electron/cloud-send.mjs";
import type { OneHomeView } from "../../electron/one-home.mjs";
import { freshCheckout } from "@/lib/cloud-plan";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";

/** The session's word for a Cloud whose machine a managed provider runs (the list's additive `provider`). */
export const MANAGED_PROVIDER = "managed";

/**
 * Where the person's cloud desktop stands, as the works-on choices offer it: none yet (`get`), its checkout open (`finish`),
 * being set up (`setup`), not running (`manage`), a Cloud that isn't managed (`other`), waking for the window (`waking`),
 * ready for this computer's bots (`move`), with them on their way (`moving`), holding them already or not taking them
 * (`open`); on its own page, holding them (`back`) or with them on their way home (`coming-back`).
 */
export type CloudDesktopStep = "get" | "finish" | "setup" | "manage" | "other" | "waking" | "move" | "moving" | "open" | "back" | "coming-back";

export interface CloudDesktopView {
  step: CloudDesktopStep;
  /** The Cloud's name, as the session lists it (this computer's page only). */
  name?: string;
  /** Whether choosing the row does anything. */
  acts: boolean;
}

const ACTS: ReadonlySet<CloudDesktopStep> = new Set(["get", "finish", "manage", "move", "open", "back"]);
const MOVING: ReadonlySet<string> = new Set(["copy", "wait", "finishing"]);

const view = (step: CloudDesktopStep, name?: string): CloudDesktopView => ({ step, ...(name ? { name } : {}), acts: ACTS.has(step) });

/** On this computer's page: from the verified session, the switch "Keep this computer's bots on this computer" and the
 * one-time move's line. Null until the session is first read. */
export function cloudDesktopOnComputer(account: CloudAccountState | null | undefined, keep: KeepHereState | null, move: OneHomeView | null | undefined, now = Date.now()): CloudDesktopView | null {
  if (!account) return null;
  if (account.status !== "connected") return view("get");
  const home = account.clouds?.find((cloud) => cloud.primary && cloud.role === "owner" && cloud.teamId === null && cloud.managed !== false) ?? null;
  // an Admin without the list says nothing of who runs the machine it has
  if (!home) return account.machine && !account.clouds ? view("other") : view("get");
  if (home.provider !== MANAGED_PROVIDER) return view("other", home.name);
  // a checkout left open is abandoned unless this app opened it in the last half hour: the offer is to get one
  if (home.status === "checkout") return freshCheckout(account, now) ? view("finish", home.name) : view("get");
  if (home.status === "setting_up") return view("setup", home.name);
  if (home.status !== "ready" && home.status !== "offline") return view("manage", home.name);
  if (keep?.coming) return view("coming-back", home.name);
  if (move && !move.place && MOVING.has(move.phase)) return view("moving", home.name);
  if (account.waking) return view("waking", home.name);
  if (keep?.shown && !keep.moved) return view("move", home.name);
  return view("open", home.name);
}

/** On the Cloud's own page: only My Cloud's, only when a managed provider runs it, and only while this computer's bots are there or on
 * their way home. */
export function cloudDesktopOnCloud(plan: CloudPlanSnapshot | null, keep: KeepHereState | null): CloudDesktopView | null {
  if (plan?.provider !== MANAGED_PROVIDER || !keep) return null;
  if (keep.coming) return view("coming-back");
  return keep.moved ? view("back") : null;
}

const HINT: Record<CloudDesktopStep, LocaleKey> = {
  get: "place.cloudDesktop.get",
  finish: "place.cloudDesktop.finish",
  setup: "place.cloudDesktop.setup",
  manage: "place.cloudDesktop.manage",
  other: "place.cloudDesktop.other",
  waking: "place.cloudDesktop.waking",
  move: "place.cloudDesktop.move",
  moving: "place.cloudDesktop.moving",
  open: "place.cloudDesktop.open",
  back: "place.cloudDesktop.back",
  "coming-back": "place.cloudDesktop.comingBack",
};

/** The row's line under its name: what choosing it does, or where things stand while it does nothing. */
export const cloudDesktopHint = (step: CloudDesktopStep): string => t(HINT[step]);
