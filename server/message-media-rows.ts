import type { DatabaseSync } from "node:sqlite";
import type { Message } from "./store.ts";

const CANDIDATES = "instr(json, 'attached-image') > 0 OR instr(json, '/api/attachments/') > 0 OR instr(json, '\"kind\":\"image\"') > 0 OR (kind = 'screen' AND instr(json, '\"png\"') > 0)";

/** Rows that may show a stored picture and carry no `media` sizes yet, in rowid order from `afterRowid`. */
export function missingMediaRows(db: DatabaseSync, afterRowid: number, limit: number): Array<{ rowid: number; threadId: string; message: Message }> {
  const rows = db.prepare(`SELECT rowid, thread_id, json FROM messages WHERE rowid > ? AND json_extract(json, '$.media') IS NULL AND (${CANDIDATES}) ORDER BY rowid LIMIT ?`)
    .all(afterRowid, limit) as Array<{ rowid: number; thread_id: string; json: string }>;
  return rows.map((row) => ({ rowid: Number(row.rowid), threadId: row.thread_id, message: JSON.parse(row.json) as Message }));
}

/** Writes only `media`, so a concurrent edit to the rest of the row is never overwritten. */
export function setMediaRow(db: DatabaseSync, threadId: string, messageId: string, media: NonNullable<Message["media"]>): void {
  db.prepare("UPDATE messages SET json = json_set(json, '$.media', json(?)) WHERE thread_id = ? AND id = ?").run(JSON.stringify(media), threadId, messageId);
}
