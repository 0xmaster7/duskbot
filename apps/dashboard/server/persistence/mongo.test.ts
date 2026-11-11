import { MongoClient } from "mongodb";
import { afterAll, describe, expect, it } from "vitest";
import { openMongoBackend } from "./mongo.ts";

// needs a replica set; DUSK_TEST_MONGODB_URI names a server whose user may drop DUSK_TEST_MONGODB_DB (default dusk_test)
const uri = process.env.DUSK_TEST_MONGODB_URI, dbName = process.env.DUSK_TEST_MONGODB_DB || "dusk_test";
const layouts = { auth: { accounts: { collection: "accounts", key: (row: Record<string, unknown>) => row.id as string, indexes: [{ keys: { email: 1 as const }, unique: true }] } } };
type Auth = { accounts: Array<{ id: string; email: string }>; v: number };
const valid = (value: unknown): value is Auth => !!value && Array.isArray((value as Auth).accounts);

async function empty() {
  const client = await MongoClient.connect(uri!), db = client.db(dbName);
  for (const { name } of await db.listCollections({}, { nameOnly: true }).toArray()) await db.collection(name).drop();
  await client.close();
}

describe.skipIf(!uri)("mongodb backend", () => {
  afterAll(empty);

  it("persists across processes, holds one writer at a time, and enforces unique indexes", async () => {
    await empty();
    const first = await openMongoBackend({ uri: uri!, db: dbName, layouts, log: () => {} });
    const store = first.backend.open<Auth>("auth", () => ({ accounts: [], v: 1 }), valid);
    store.state.accounts.push({ id: "a1", email: "one@example.test" });
    store.commit();
    await first.backend.settled();

    await expect(openMongoBackend({ uri: uri!, db: dbName, layouts, log: () => {}, acquireWaitMs: 3000 })).rejects.toThrow(/writer lease/);

    store.state.accounts.push({ id: "a2", email: "one@example.test" });
    store.commit();
    await expect(first.backend.settled(1500)).rejects.toThrow();
    expect(first.backend.health().ok).toBe(false);
    store.state.accounts.pop();
    store.commit();
    await first.backend.settled(15_000);
    await first.close();

    const second = await openMongoBackend({ uri: uri!, db: dbName, layouts, log: () => {} });
    const again = second.backend.open<Auth>("auth", () => ({ accounts: [], v: 1 }), valid);
    expect(again.state).toEqual({ v: 1, accounts: [{ id: "a1", email: "one@example.test" }] });
    await second.close();
  }, 90_000);
});
