import { mkdirSync, readFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { writeFileAtomic } from "../atomic.ts";

export const SLACK_THREADS_FILE = "slack-threads.json";
const conversationSchema = z.object({
  botId: z.string(), threadId: z.string(), channel: z.string(), threadTs: z.string().optional(), createdAt: z.number().finite(),
});
const postedSchema = z.object({ threadId: z.string(), messageId: z.string(), at: z.number().finite() });
const schema = z.object({
  version: z.literal(1), conversations: z.record(z.string(), conversationSchema), posted: z.record(z.string(), postedSchema),
});
type Conversation = z.infer<typeof conversationSchema>;
type Posted = z.infer<typeof postedSchema>;

export class SlackThreadMap {
  private readonly path: string;
  private data: z.infer<typeof schema> = { version: 1, conversations: {}, posted: {} };

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.path = join(dataDir, SLACK_THREADS_FILE);
    try {
      this.data = schema.parse(JSON.parse(readFileSync(this.path, "utf8")));
      this.prune();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      try { renameSync(this.path, `${this.path}.unreadable-${Date.now()}`); } catch {}
      console.warn("Slack conversation history could not be read. Starting empty.");
    }
  }

  conversation(key: string): Conversation | undefined {
    const value = Object.hasOwn(this.data.conversations, key) ? this.data.conversations[key] : undefined;
    return value ? { ...value } : undefined;
  }

  setConversation(key: string, value: Conversation): void {
    Object.defineProperty(this.data.conversations, key, { value: { ...value }, enumerable: true, configurable: true, writable: true });
    this.save();
  }

  removeThread(threadId: string): void {
    this.data.conversations = Object.fromEntries(Object.entries(this.data.conversations).filter(([, value]) => value.threadId !== threadId));
    this.data.posted = Object.fromEntries(Object.entries(this.data.posted).filter(([, value]) => value.threadId !== threadId));
    this.save();
  }

  removeBot(botId: string): void {
    this.data.conversations = Object.fromEntries(Object.entries(this.data.conversations).filter(([, value]) => value.botId !== botId));
    this.data.posted = Object.fromEntries(Object.entries(this.data.posted).filter(([key]) => !key.startsWith(`${botId}:`)));
    this.save();
  }

  posted(botId: string, channel: string, ts: string): Posted | undefined {
    const value = this.data.posted[`${botId}:${channel}:${ts}`];
    return value ? { ...value } : undefined;
  }

  notePosted(botId: string, channel: string, ts: string, threadId: string, messageId: string, at: number): void {
    this.data.posted[`${botId}:${channel}:${ts}`] = { threadId, messageId, at };
    this.prune();
    this.save();
  }

  private prune(): void {
    const entries = Object.entries(this.data.posted);
    if (entries.length > 5000) this.data.posted = Object.fromEntries(entries.sort((a, b) => b[1].at - a[1].at).slice(0, 5000));
  }

  private save(): void {
    writeFileAtomic(this.path, JSON.stringify(this.data), { mode: 0o600 });
  }
}
