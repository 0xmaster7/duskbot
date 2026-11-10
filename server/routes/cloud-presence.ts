// The app's two words to a Cloud home about the person, both after the auth gate: `POST /api/cloud/focus` while its
// window is focused on the home (a hint the Admin's power policy weighs, never someone using it: a background path in
// cloud-power.ts), and `POST /api/cloud/wake` from a page whose home went to sleep, the person's key press or click
// (someone using it, so the gate already counted it; through the public edge a credentialed POST is also what wakes a
// stopped machine). Only a Cloud home keeps focus; anywhere else focus is a 404 and wake a no-op.
import { CLOUD_FOCUS_PATH, cloudPowerNow } from "../cloud-power.ts";
import { PASS, type RouteHandler } from "./table.ts";

export const CLOUD_WAKE_PATH = "/api/cloud/wake";

export function createCloudPresenceRoutes(power: () => { noteFocus?(): void } | null = cloudPowerNow): RouteHandler {
  return async ({ res, path, method, json }) => {
    if (method !== "POST" || (path !== CLOUD_FOCUS_PATH && path !== CLOUD_WAKE_PATH)) return PASS;
    if (path === CLOUD_WAKE_PATH) return void json(res, 200, { ok: true });
    const home = power();
    if (!home?.noteFocus) return void json(res, 404, { error: "not_found" });
    home.noteFocus();
    json(res, 200, { ok: true });
  };
}

export const cloudPresenceRoutes = createCloudPresenceRoutes();
