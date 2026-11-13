// The fake engine works a six-step plan one step per turn: the rows the chat reads carry each plan call's steps, and the
// checklist the chat builds from them moves forward as the bot works, ending at six of six.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { planAnchors, type PlanRow } from "../shared/turn-plan.ts";
import { launchVerificationServer, runControlDusk } from "../scripts/control-dusk.ts";

const STEPS = ["Find flights", "Compare hotels", "Check visa rules", "Price local transport", "Draft the itinerary", "Total the budget"];
const plan = (done: number) => ({ name: "TodoWrite", input: { todos: STEPS.map((content, i) => ({ content, status: i < done ? "completed" : i === done ? "in_progress" : "pending" })) } });

it("streams the bot's plan into rows the chat turns into a live checklist", async () => {
  const scratch = mkdtempSync(join(tmpdir(), "dusk-plan-checklist-"));
  const replies = STEPS.map((step, i) => (i === STEPS.length - 1 ? "Your Lisbon trip plan is ready." : `${step}: done.`));
  const fixture = await launchVerificationServer({
    ...process.env,
    FAKE_CLAUDE_REPLIES: JSON.stringify(replies),
    FAKE_CLAUDE_REPLY_STATE: join(scratch, "replies.state"),
    FAKE_CLAUDE_TOOL_CALLS_BY_TURN: JSON.stringify(STEPS.map((_, i) => [plan(i + 1)])),
  });
  const cli = (...args: string[]) => runControlDusk([...args, "--url", fixture.info.url]) as Promise<any>;
  const rows = async (threadId: string) => {
    const response = await fetch(`${fixture.info.url}/api/threads/${encodeURIComponent(threadId)}/messages?limit=200`);
    return ((await response.json()) as { messages: Array<PlanRow & { text?: string }> }).messages;
  };
  try {
    const { bot } = await cli("new-bot", "--name", "Planner");
    await cli("send", "--bot", bot.id, "--task", bot.activeTaskId, "--text", "Plan a five-day Lisbon trip for two in May.");
    const seen: number[] = [];
    await expect.poll(async () => {
      const all = await rows(bot.activeTaskId);
      const anchors = [...planAnchors(all).values()];
      if (anchors.length === 1 && seen.at(-1) !== anchors[0]!.plan.done) seen.push(anchors[0]!.plan.done);
      return all.some((row) => row.text === replies.at(-1)) && anchors[0]?.plan.done === STEPS.length;
    }, { timeout: 60_000, interval: 100 }).toBe(true);

    const all = await rows(bot.activeTaskId);
    const anchors = planAnchors(all);
    // one checklist for the one ask, at its newest plan call, however many turns the plan took
    expect(anchors.size).toBe(1);
    const [anchorId, anchor] = [...anchors][0]!;
    expect(all.filter((row) => row.tool?.name === "TodoWrite").at(-1)!.id).toBe(anchorId);
    expect(anchor.newest).toBe(true);
    expect(anchor.plan.steps.map((step) => step.text)).toEqual(STEPS);
    expect(anchor.plan.steps.every((step) => step.state === "done")).toBe(true);
    // what the chat showed along the way only ever moved forward
    expect(seen.length).toBeGreaterThan(0);
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
  } finally {
    await fixture.close();
    rmSync(scratch, { recursive: true, force: true });
  }
}, 120_000);
