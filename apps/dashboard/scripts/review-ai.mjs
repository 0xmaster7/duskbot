// The review cloud's demo bot answers through a dusk-owned OpenRouter key (DUSK_REVIEW_AI_OPENROUTER_KEY), not the
// cloud's free model, whose shared free quota runs out. The key's own credit limit at OpenRouter is the spend cap.
export const REVIEW_AI = { name: "Demo AI", url: "https://openrouter.ai/api/v1", model: "openai/gpt-4o-mini" };

/**
 * Adds the key to the home as an OpenAI-compatible engine once (found again by its name) and points the demo bot at it.
 * `call(path, init)` reaches the home with a paired session. Returns what changed, for the log.
 */
export async function wireDemoAi(call, { botId, key, model = REVIEW_AI.model }) {
  if (!key) return { wired: false, reason: "missing DUSK_REVIEW_AI_OPENROUTER_KEY: the demo bot stays on the cloud's own AI" };
  const listed = await call("/api/instances");
  if (!listed.ok) throw new Error(`the home's engines answered ${listed.status}`);
  let instance = (listed.data?.instances ?? []).find((item) => item.displayName === REVIEW_AI.name);
  let added = false;
  if (!instance) {
    const made = await call("/api/instances/openai-compat", { method: "POST", body: { displayName: REVIEW_AI.name, url: REVIEW_AI.url, key, models: [model] } });
    if (!made.ok) throw new Error(`adding the demo AI answered ${made.status} (${made.data?.error ?? "no detail"})`);
    instance = { instanceId: made.data.instanceId };
    added = true;
  }
  const bots = await call("/api/bots?messages=0");
  const bot = (bots.data?.bots ?? []).find((item) => item.id === botId);
  if (!bot) throw new Error("the demo bot is gone");
  const pointed = bot.modelSelection?.instanceId === instance.instanceId && bot.modelSelection?.model === model;
  if (!pointed) {
    const patched = await call(`/api/bots/${botId}`, { method: "PATCH", body: { modelSelection: { instanceId: instance.instanceId, model } } });
    if (!patched.ok) throw new Error(`pointing the demo bot at the demo AI answered ${patched.status} (${patched.data?.error ?? "no detail"})`);
  }
  return { wired: true, added, pointed: !pointed, instanceId: instance.instanceId, model };
}
