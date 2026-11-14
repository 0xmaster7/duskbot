// The few HTTP calls the eval makes against a sandbox server: the same routes the app uses.
export function client(base: string) {
  const call = async (method: string, path: string, body?: unknown): Promise<any> => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { "content-type": "application/json", origin: base },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const parsed = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${parsed.error ?? "?"}`);
    return parsed;
  };
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  async function waitTurn(threadId: string, timeoutMs: number): Promise<string> {
    let version: string | undefined;
    let state = "";
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const q = new URLSearchParams({ scope: "turn", ...(version ? { version, wait: "5000" } : {}) });
      const job = await call("GET", `/api/threads/${threadId}/job?${q}`);
      state = job.state;
      if (version !== undefined && ["needs-input", "completed", "failed", "stalled", "idle"].includes(state)) return state;
      if (Date.now() > deadline) return `timeout(${state})`;
      version = String(job.version);
    }
  }

  return {
    call,
    async createBot(name: string, model: string): Promise<{ id: string; threadId: string }> {
      const { bot } = await call("POST", "/api/bots", { name });
      await call("PATCH", `/api/bots/${bot.id}`, { name, modelSelection: { instanceId: "gw", model }, computer: "off", browser: false });
      return { id: bot.id, threadId: bot.threadId };
    },
    async bots(): Promise<Array<{ id: string; name: string }>> {
      return (await call("GET", "/api/bots?messages=0")).bots;
    },
    async newThread(botId: string): Promise<string> {
      const created = await call("POST", `/api/bots/${botId}/tasks`, { select: false });
      return created.task.threadId ?? created.task.id;
    },
    /** Sends one message and waits for the turn; returns the bot's reply text. */
    async say(botId: string, threadId: string, text: string): Promise<{ reply: string; state: string }> {
      const before = (await call("GET", `/api/threads/${threadId}/messages?limit=200`)).messages.length;
      await call("POST", `/api/bots/${botId}/messages`, { text, threadId });
      await sleep(500);
      const state = await waitTurn(threadId, 240_000);
      const after = (await call("GET", `/api/threads/${threadId}/messages?limit=200`)).messages as Array<{ role: string; kind?: string; text?: string }>;
      const reply = after.slice(before).filter((m) => m.role !== "user" && m.kind === "text" && m.text).map((m) => m.text).join("\n");
      return { reply, state };
    },
    async upkeep(botId: string): Promise<{ lastCapture?: { at: number }; lastTidy?: { at: number } }> {
      return call("GET", `/api/bots/${botId}/memory/upkeep`);
    },
    /** Capture runs after the chat goes quiet; wait until one newer than `since` is recorded, or give up. */
    async waitCapture(botId: string, since: number, timeoutMs = 120_000): Promise<boolean> {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const status = await call("GET", `/api/bots/${botId}/memory/upkeep`);
        if ((status.lastCapture?.at ?? 0) > since) return true;
        await sleep(2_000);
      }
      return false;
    },
    tidy: (botId: string) => call("POST", `/api/bots/${botId}/memory/tidy`, {}),
    /** The shared tier's consolidation, when this build has one; null on a build without it. */
    async consolidateGeneral(): Promise<unknown> {
      try {
        return await call("POST", "/api/profile/general/consolidate", {});
      } catch (error) {
        if (/-> 404/.test((error as Error).message)) return null;
        throw error;
      }
    },
    async aboutMe(): Promise<string> {
      return (await call("GET", "/api/config")).profile?.aboutMe ?? "";
    },
    /** Every file of a bot's memory, keyed by path: MEMORY.md, topics, the archive (not daily logs). */
    async botMemory(botId: string): Promise<Record<string, string>> {
      const overview = await call("GET", `/api/bots/${botId}/memory`);
      const out: Record<string, string> = { "MEMORY.md": overview.text ?? "" };
      for (const topic of overview.topics ?? []) {
        const path = typeof topic === "string" ? topic : topic.path;
        if (!path || path.startsWith("memory/log/")) continue;
        out[path] = (await call("GET", `/api/bots/${botId}/memory/file?path=${encodeURIComponent(path)}`)).text ?? "";
      }
      return out;
    },
  };
}
