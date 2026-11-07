// The person's own devices behind the one device MCP server: their paired phones (server/host/phones.ts) and their Mac
// (server/mac-control/host.ts). Same shape as the phones alone, so a turn mounts, prompts and answers both through it.
import type { PhoneBot, PhonePlace } from "../phones/access.ts";
import { PHONE_INSTRUCTIONS } from "../phones/instructions.ts";
import type { MacControl } from "../mac-control/host.ts";
import { MAC_INSTRUCTIONS } from "../mac-control/instructions.ts";
import type { BotRecord } from "../store.ts";
import { PASS } from "../routes/table.ts";
import type { PromptPart } from "../system-prompt.ts";
import type { Phones } from "./phones.ts";

type Turn = { botId: string; threadId: string; generation: string };

export type Devices = Omit<Phones, "handle"> & { handle(body: unknown, capability: Turn, assertActive: () => void): Promise<unknown> };

export function withMacControl(phones: Phones, mac: MacControl, botById: (id: string) => BotRecord | null | undefined): Devices {
  return {
    ...phones,
    integration(bot: BotRecord, turn: { threadId: string; generation: string }) {
      return phones.integration(bot, turn) ?? (mac.mounts(bot, { botId: bot.id, ...turn }) ? phones.deviceMount(bot, turn) : null);
    },
    promptParts(bot: PhoneBot & { macControl?: boolean }, input: { mounted: boolean; offered: boolean; turn: Turn; place: PhonePlace }): PromptPart[] {
      const phoneParts = phones.promptParts(bot, { ...input, mounted: input.mounted && phones.mounts(bot, input.turn) });
      return [...phoneParts, input.mounted ? mac.promptPart(bot, input.turn) : { id: "mac", label: "Your Mac", text: "" }];
    },
    previewParts(bot: PhoneBot & { macControl?: boolean }, offered: boolean): PromptPart[] {
      return [...phones.previewParts(bot, offered), ...(offered ? [mac.previewPart(bot)] : [])];
    },
    async handle(body: unknown, capability: Turn, assertActive: () => void) {
      const request = (body ?? {}) as { method?: unknown; params?: unknown };
      if (request.method === "tools/list") {
        assertActive();
        const live = botById(capability.botId);
        const phone = live && phones.mounts(live, capability) ? await phones.handle(body, capability, assertActive) as { tools: unknown[] } : { tools: [] };
        const macTools = mac.tools(capability);
        return { tools: [...phone.tools, ...macTools], instructions: [phone.tools.length ? PHONE_INSTRUCTIONS : "", macTools.length ? MAC_INSTRUCTIONS : ""].filter(Boolean).join(" ") };
      }
      if (request.method === "tools/call" && mac.handles((request.params as { name?: unknown } | undefined)?.name)) {
        return mac.call(request.params, capability, assertActive);
      }
      return phones.handle(body, capability, assertActive);
    },
    routes: async (ctx) => {
      return await mac.routes(ctx) === PASS ? phones.routes(ctx) : undefined;
    },
    close() {
      mac.close();
      phones.close();
    },
  };
}
