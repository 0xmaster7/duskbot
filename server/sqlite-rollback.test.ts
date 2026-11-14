import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import { isDiskFull, rollbackKeeping } from "./sqlite-rollback.ts";

describe("a write on a full disk", () => {
  it("keeps SQLite's own 'disk is full' error, not the failed ROLLBACK after SQLite already rolled back", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE t(x TEXT)");
    db.exec("PRAGMA max_page_count = 3");
    db.exec("BEGIN IMMEDIATE");
    let thrown: unknown;
    try {
      try {
        const insert = db.prepare("INSERT INTO t VALUES (?)");
        for (let i = 0; i < 100; i++) insert.run("x".repeat(4000));
      } catch (error) { rollbackKeeping(db, error); }
    } catch (error) { thrown = error; }
    expect((thrown as Error).message).toMatch(/database or disk is full/);
    expect(isDiskFull(thrown)).toBe(true);
    expect(db.isTransaction).toBe(false);
  });

  it("still rolls back a transaction SQLite left open", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE t(x TEXT)");
    db.exec("BEGIN IMMEDIATE");
    db.exec("INSERT INTO t VALUES ('kept out')");
    expect(() => rollbackKeeping(db, new Error("boom"))).toThrow("boom");
    expect(db.prepare("SELECT count(*) AS n FROM t").get()).toEqual({ n: 0 });
    expect(isDiskFull(Object.assign(new Error("write failed"), { code: "ENOSPC" }))).toBe(true);
    expect(isDiskFull(new Error("cannot rollback - no transaction is active"))).toBe(false);
  });
});
