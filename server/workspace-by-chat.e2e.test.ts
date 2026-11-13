// Managing the workspace by chat, end to end on a real server with the fake engine scripting each tool call the way a
// model would: the person asks Dusk for a bot that watches competitors and to tell it they like short reports. Dusk makes
// it from a ready-made template, passes the preference into its notebook once, gives it an automation and searches
// earlier chats; the new bot then says hello in its own chat. No model and no real account is reached.
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { launchVerificationServer, runControlDusk } from "../scripts/control-dusk.ts";

const HELLO = "Hi, I'm Scout. I keep watch on your competitors. Which ones should I start with?";
const agents = (name: string, input: Record<string, unknown>) => ({ server: "agents", name, input });

it("a bot makes a bot from a template, passes a note to it once, gives it an automation, and the new bot says hello", async () => {
  const scratch = mkdtempSync(join(tmpdir(), "dusk-workspace-by-chat-"));
  const fixture = await launchVerificationServer({
    ...process.env,
    FAKE_CLAUDE_REPLIES: JSON.stringify(["Made Scout and told it you like short reports.", HELLO]),
    FAKE_CLAUDE_REPLY_STATE: join(scratch, "replies.state"),
    FAKE_CLAUDE_TOOL_CALLS_BY_TURN: JSON.stringify([
      [
        agents("list_team_library", {}),
        agents("create_bot", { template: "research", name: "Scout", role: "Competitor watcher", color: "purple" }),
        agents("memory_update", { action: "append", text: "Prefers short reports.", for_bot_id: "Scout" }),
        agents("memory_update", { action: "append", text: "prefers short reports", for_bot_id: "Scout" }),
        agents("memory_update", { action: "forget", old_text: "short reports", for_bot_id: "Scout" }),
        agents("trigger", { action: "create", when: "schedule", name: "Competitor watch", instructions: "Check the competitors' sites and send me what changed.",
          schedule: { type: "daily", time: "09:00" }, for_bot_id: "Scout" }),
        agents("session_search", { since: "1d" }),
      ],
      [],
    ]),
  });
  const cli = (...args: string[]) => runControlDusk([...args, "--url", fixture.info.url]) as Promise<any>;
  const get = async (path: string) => (await (await fetch(`${fixture.info.url}${path}`)).json()) as any;
  const rows = async (threadId: string) => (await get(`/api/threads/${encodeURIComponent(threadId)}/messages?limit=200`)).messages as Array<{
    role: string; kind: string; text?: string; tool?: { name: string; ok?: boolean; output?: string; result?: string } }>;
  try {
    const [dusk] = (await get("/api/bots")).bots as any[];
    expect(dusk.defaultBot).toBeDefined();
    await cli("send", "--bot", dusk.id, "--text", "Make me a bot that watches my competitors, and tell it I prefer short reports.");

    await expect.poll(async () => ((await get("/api/bots")).bots as any[]).some((bot) => bot.name === "Scout"), { timeout: 60_000 }).toBe(true);
    const scout = ((await get("/api/bots")).bots as any[]).find((bot) => bot.name === "Scout");
    // the template's look and instructions, with the name and role the bot chose
    expect(scout).toMatchObject({ title: "Competitor watcher", color: "purple" });
    expect(scout.mascotBody).toEqual(expect.any(String));

    // it greets in its own chat at once, with no line from the person
    await expect.poll(async () => (await rows(scout.threadId)).some((row) => row.role === "bot" && row.text === HELLO), { timeout: 60_000 }).toBe(true);
    expect((await rows(scout.threadId)).filter((row) => row.role === "user")).toEqual([]);

    // the person's preference is in Scout's notebook once, marked as from Dusk; forget for another bot was refused
    const notebook = join(fixture.info.dataDir, "workspaces", scout.id, "MEMORY.md");
    await expect.poll(() => existsSync(notebook) && readFileSync(notebook, "utf8").includes("Prefers short reports."), { timeout: 30_000 }).toBe(true);
    const notes = readFileSync(notebook, "utf8");
    expect(notes).toContain(`from @${dusk.name} · Prefers short reports.`);
    expect(notes.match(/short reports/gi)).toHaveLength(1);

    await expect.poll(async () => (await rows(dusk.threadId)).some((row) => row.text === "Made Scout and told it you like short reports."), { timeout: 60_000 }).toBe(true);
    // the automation belongs to Scout
    await expect.poll(async () => ((await get("/api/routines")).routines as any[]).find((routine) => routine.name === "Competitor watch")?.botId, { timeout: 30_000 }).toBe(scout.id);

    // every scripted call reached its tool: the person sees one row per call, and only the refused forget failed
    await expect.poll(async () => (await rows(dusk.threadId)).some((row) => row.text === "Made Scout and told it you like short reports."), { timeout: 60_000 }).toBe(true);
    const results = (await rows(dusk.threadId)).filter((row) => row.tool).map((row) => [row.tool!.name, row.tool!.ok]);
    expect(results).toEqual([["list_team_library", true], ["create_bot", true], ["memory_update", true], ["memory_update", true],
      ["memory_update", false], ["trigger", true], ["session_search", true]]);
  } finally {
    await fixture.close();
    rmSync(scratch, { recursive: true, force: true });
  }
}, 150_000);
