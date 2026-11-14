import { useCallback, useEffect, useRef, useState } from "react";

import { BOTS_LOOK_TIME_BOX_MS, lookForOtherBots, planBotMove, type BotMovePlan } from "@/lib/bot-move";
import { api, useStore } from "@/state/store";

/** Looks for other agent apps' bots on this computer and plans their move; the plan is null while looking, and stays
 * empty when nothing is here. The bringing in itself is bringChosen's (BringIn). */
/** `downloads: false`: Grok bot exports in Downloads are not looked for (the first run, where macOS must not ask yet). */
export function useBotMove(options: { look?: boolean; downloads?: boolean } = {}) {
  const { state } = useStore();
  const [plan, setPlan] = useState<BotMovePlan | null>(null);
  const bots = useRef(state.bots);
  bots.current = state.bots;

  const look = useCallback(async () => {
    const [found, servers] = await Promise.all([
      lookForOtherBots(undefined, { downloads: options.downloads !== false }),
      api<{ servers?: Array<{ name: string }> }>("/api/mcp/servers", { timeoutMs: BOTS_LOOK_TIME_BOX_MS }).then((answer) => answer.servers ?? [], () => []),
    ]);
    const next = planBotMove(found, { bots: bots.current, servers: new Set(servers.map((server) => server.name)), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });
    setPlan(next);
    return next;
  }, [options.downloads]);

  useEffect(() => {
    if (options.look !== false) void look();
  }, [look, options.look]);

  return { plan, look };
}
