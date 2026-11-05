// Phase one of the seed, against the demo harness over HTTP with the same requests the app makes: the team import
// (bots, looks, instructions, sections, memory, rooms, conversation text), skills, routines and webhooks.
import { BOTS, D, MEMORY, ROOMS, ROUTINES, SKILLS, WEBHOOKS, threads } from "./content.mjs";
import { backupProjection, buildThread } from "./transcripts.mjs";

async function call(base, method, path, body) {
  const response = await fetch(`${base}${path}`, body === undefined
    ? { method }
    : { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const text = await response.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch {}
  if (!response.ok) throw new Error(`${method} ${path} -> ${response.status}: ${parsed?.error ?? text.slice(0, 300)}`);
  return parsed;
}

const day = (now, daysAgo) => new Date(now - daysAgo * D).toISOString().slice(0, 10);

export function teamBackup(now) {
  const conversations = threads();
  const bots = BOTS.map((bot) => {
    const tasks = conversations[bot.key].map((thread) => {
      const built = buildThread(bot.key, thread, { now, attachmentsDir: "/unused" });
      const messages = backupProjection(built);
      return { key: thread.key, title: thread.title, createdAt: built.createdAt, activeLeafId: messages.at(-1).id, messages };
    });
    const memory = MEMORY[bot.key];
    return {
      key: bot.key, name: bot.name, title: bot.title, description: bot.description, soul: bot.soul,
      section: bot.section, color: bot.color, mascotBody: bot.mascotBody,
      chiefOfStaff: Boolean(bot.chief), hidden: false, playbooks: [],
      activeTask: tasks[0].key, tasks,
      ...(memory ? { memory: { file: memory.file, topics: memory.topics, logs: memory.logs.map((log) => ({ name: `${day(now, log.day)}.md`, text: log.text })) } } : {}),
    };
  });
  const byKey = new Map(BOTS.map((bot) => [bot.key, bot]));
  const groups = ROOMS.map((room) => {
    let at = now - room.ago;
    const messages = room.lines.map((line, i) => {
      const speaker = line.from ? byKey.get(line.from) : null;
      at += 50e3;
      return {
        id: `demo-room-${room.key}-${i + 1}`, role: speaker ? "bot" : "user", text: line.text, at,
        parentId: i === 0 ? null : `demo-room-${room.key}-${i}`,
        ...(speaker ? { from: { botId: speaker.key, name: speaker.name, color: speaker.color } } : {}),
      };
    });
    return {
      key: room.key, name: room.name, section: room.section, memberIds: room.members, dm: false,
      bulletin: room.bulletin, defaultResponder: room.responder, activeTask: "main",
      tasks: [{ key: "main", title: room.name, createdAt: now - room.ago, activeLeafId: messages.at(-1).id, messages }],
    };
  });
  return { format: "openmaus.backup", version: 1, name: "OpenMausBot demo", exportedAt: now, warnings: [], bots, groups, routines: [] };
}

/** @returns the ids the offline phase needs: each demo bot's id and the thread id of each of its conversations. */
export async function seedLive(base, now, log = console.log) {
  const imported = await call(base, "POST", "/api/teams/import?mode=add", teamBackup(now));
  const conversations = threads();
  const state = { now, bots: {}, routines: {}, webhooks: {} };
  for (const bot of BOTS) {
    const record = imported.bots.find((candidate) => candidate.name === bot.name);
    if (!record) throw new Error(`the import did not create ${bot.name}`);
    const tasks = record.tasks ?? [];
    const threadIds = {};
    for (const thread of conversations[bot.key]) {
      const task = tasks.find((candidate) => candidate.title === thread.title);
      if (!task) throw new Error(`the import did not create ${bot.name}'s "${thread.title}"`);
      threadIds[thread.key] = task.threadId;
    }
    state.bots[bot.key] = { id: record.id, threads: threadIds };
  }
  log(`  imported ${imported.bots.length} bots and ${imported.groups.length} room(s)`);

  const ids = (key) => state.bots[key].id;
  await Promise.all(BOTS.map((bot) => call(base, "PATCH", `/api/bots/${ids(bot.key)}`, { approvalMode: "ask" })));
  log("  approval level: Ask me first, on every demo bot");

  // What the "Meet MausBot" card's Add button saves: MausBot stays pinned in the sidebar and the card is not shown again.
  const roster = await call(base, "GET", "/api/bots?messages=0");
  const helper = roster.bots.find((bot) => bot.defaultBot);
  if (helper) await call(base, "PATCH", `/api/bots/${helper.id}`, { welcomed: true, sidebarHidden: false, pinned: true });

  await Promise.all(Object.entries(SKILLS).flatMap(([key, skills]) => skills.map((skill) =>
    call(base, "POST", `/api/bots/${ids(key)}/skill-template`, {
      name: skill.name, description: skill.description, warnings: [], source: "openmausbot-demo", text: skill.text, enabled: true,
    }))));
  log(`  skills: ${Object.values(SKILLS).flat().map((skill) => skill.name).join(", ")}`);

  for (const routine of ROUTINES) {
    const schedule = routine.schedule.type === "interval" ? { ...routine.schedule, anchorAt: now } : routine.schedule;
    const created = await call(base, "POST", "/api/routines", {
      name: routine.name, prompt: routine.prompt, botId: ids(routine.bot), target: "bot", runOn: "maus",
      schedule, enabled: routine.enabled, durationMinutes: 15,
    });
    state.routines[routine.name] = { id: created.routine.id, botId: ids(routine.bot) };
  }
  log(`  routines: ${ROUTINES.length} scheduled (${ROUTINES.filter((routine) => routine.enabled).length} on)`);

  const credentials = {};
  for (const hook of WEBHOOKS) {
    const created = await call(base, "POST", "/api/webhooks", {
      name: hook.name, prompt: hook.prompt, botId: ids(hook.bot), delivery: hook.delivery, enabled: true,
    });
    state.webhooks[hook.name] = { id: created.webhook.id, botId: ids(hook.bot) };
    credentials[hook.name] = created.credential ?? null;
  }
  log(`  webhooks: ${WEBHOOKS.map((hook) => hook.name).join(", ")}`);
  return { state, credentials };
}
