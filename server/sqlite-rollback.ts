import type { DatabaseSync } from "node:sqlite";

/** SQLite rolls a transaction back by itself on some errors (SQLITE_FULL: a full disk), and a ROLLBACK after that
 * throws "no transaction is active", which would hide the error that matters. */
export function rollbackKeeping(database: DatabaseSync, error: unknown): never {
  if (database.isTransaction) database.exec("ROLLBACK");
  throw error;
}

/** A write that failed because the disk is full: Node's ENOSPC, SQLite's SQLITE_FULL (13). */
export function isDiskFull(error: unknown): boolean {
  const { code, errcode, message } = (error ?? {}) as { code?: unknown; errcode?: unknown; message?: unknown };
  return code === "ENOSPC" || errcode === 13 || (typeof message === "string" && /\bdatabase or disk is full\b|\bENOSPC\b/.test(message));
}
