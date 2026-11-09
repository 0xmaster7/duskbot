import type { CloudAccountState, CloudPlanSnapshot } from "../../electron/cloud-account.mjs";
import type { KeepHereState } from "../../electron/cloud-send.mjs";
import type { OneHomeView } from "../../electron/one-home.mjs";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";

/** The session's word for a Cloud whose machine Boat runs (the list's additive `provider`). */
export const BOAT_PROVIDER = "boat";

/**
 * Where the person's Boat cloud stands, as the works-on choices offer it: none yet (`get`), its checkout open (`finish`),
 * being set up (`setup`), not running (`manage`), a Cloud that isn't Boat's (`other`), waking for the window (`waking`),
 * ready for this computer's bots (`move`), with them on their way (`moving`), holding them already or not taking them
 * (`open`); on its own page, holding them (`back`) or with them on their way home (`coming-back`).
 */
export type BoatCloudStep = "get" | "finish" | "setup" | "manage" | "other" | "waking" | "move" | "moving" | "open" | "back" | "coming-back";

export interface BoatCloudView {
  step: BoatCloudStep;
  /** The Cloud's name, as the session lists it (this computer's page only). */
  name?: string;
  /** Whether choosing the row does anything. */
  acts: boolean;
}

const ACTS: ReadonlySet<BoatCloudStep> = new Set(["get", "finish", "manage", "move", "open", "back"]);
const MOVING: ReadonlySet<string> = new Set(["copy", "wait", "finishing"]);

const view = (step: BoatCloudStep, name?: string): BoatCloudView => ({ step, ...(name ? { name } : {}), acts: ACTS.has(step) });

/** On this computer's page: from the verified session, the switch "Keep this computer's bots on this computer" and the
 * one-time move's line. Null until the session is first read. */
export function boatCloudOnComputer(account: CloudAccountState | null | undefined, keep: KeepHereState | null, move: OneHomeView | null | undefined): BoatCloudView | null {
  if (!account) return null;
  if (account.status !== "connected") return view("get");
  const home = account.clouds?.find((cloud) => cloud.primary && cloud.role === "owner" && cloud.teamId === null && cloud.managed !== false) ?? null;
  // an Admin without the list says nothing of who runs the machine it has
  if (!home) return account.machine && !account.clouds ? view("other") : view("get");
  if (home.provider !== BOAT_PROVIDER) return view("other", home.name);
  if (home.status === "checkout") return view("finish", home.name);
  if (home.status === "setting_up") return view("setup", home.name);
  if (home.status !== "ready" && home.status !== "offline") return view("manage", home.name);
  if (keep?.coming) return view("coming-back", home.name);
  if (move && !move.place && MOVING.has(move.phase)) return view("moving", home.name);
  if (account.waking) return view("waking", home.name);
  if (keep?.shown && !keep.moved) return view("move", home.name);
  return view("open", home.name);
}

/** On the Cloud's own page: only My Cloud's, only when Boat runs it, and only while this computer's bots are there or on
 * their way home. */
export function boatCloudOnCloud(plan: CloudPlanSnapshot | null, keep: KeepHereState | null): BoatCloudView | null {
  if (plan?.provider !== BOAT_PROVIDER || !keep) return null;
  if (keep.coming) return view("coming-back");
  return keep.moved ? view("back") : null;
}

const HINT: Record<BoatCloudStep, LocaleKey> = {
  get: "place.boat.get",
  finish: "place.boat.finish",
  setup: "place.boat.setup",
  manage: "place.boat.manage",
  other: "place.boat.other",
  waking: "place.boat.waking",
  move: "place.boat.move",
  moving: "place.boat.moving",
  open: "place.boat.open",
  back: "place.boat.back",
  "coming-back": "place.boat.comingBack",
};

/** The row's line under its name: what choosing it does, or where things stand while it does nothing. */
export const boatCloudHint = (step: BoatCloudStep): string => t(HINT[step]);
