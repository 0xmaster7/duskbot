import { DEFAULT_DASHBOARD_URL } from "../../shared/dashboard-protocol";
import { api } from "@/state/api";
import { openExternalLink } from "./app-links";

interface LinkAnswer { claimUrl: string; dashboardUrl: string; workspaceId: string; claimed: boolean }

/** where the account dashboard opens for the server this window shows: its one-time claim link the first time, the
 * workspace's page after that. the server enrolls itself (POST /api/dashboard/link), so a Mac, a VPS seen through the
 * link and a phone all connect the same way. */
export async function accountDashboardUrl(): Promise<string> {
  try {
    const link = await api<LinkAnswer>("/api/dashboard/link", { method: "POST", body: "{}", timeoutMs: 15_000 });
    return link.claimed ? `${link.dashboardUrl}/?workspace=${encodeURIComponent(link.workspaceId)}` : link.claimUrl;
  } catch (error) {
    // an older server or one that cannot reach the service still gets the person to their dashboard
    console.warn("account dashboard link failed", error instanceof Error ? error.message : error);
    return DEFAULT_DASHBOARD_URL;
  }
}

export async function openAccountDashboard(): Promise<void> {
  await openExternalLink(await accountDashboardUrl());
}
