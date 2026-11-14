import type { DatabaseSync } from "node:sqlite";

export function ensureMemoryIndex(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_files (
      bot_id TEXT NOT NULL,
      path TEXT NOT NULL,
      text TEXT NOT NULL,
      mtime_ms INTEGER NOT NULL,
      bytes INTEGER NOT NULL,
      PRIMARY KEY (bot_id, path)
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
      text, content='memory_files', content_rowid='rowid', tokenize='unicode61'
    );
    CREATE TRIGGER IF NOT EXISTS memory_fts_ai AFTER INSERT ON memory_files BEGIN
      INSERT INTO memory_fts(rowid, text) VALUES (new.rowid, new.text);
    END;
    CREATE TRIGGER IF NOT EXISTS memory_fts_ad AFTER DELETE ON memory_files BEGIN
      INSERT INTO memory_fts(memory_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
    END;
    CREATE TRIGGER IF NOT EXISTS memory_fts_au AFTER UPDATE ON memory_files BEGIN
      INSERT INTO memory_fts(memory_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
      INSERT INTO memory_fts(rowid, text) VALUES (new.rowid, new.text);
    END;
  `);
}

/** One row per remembered fact: the text lives in the memory files and About me, the structure lives here. */
export function ensureFactStore(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_facts (
      id TEXT PRIMARY KEY,
      owner TEXT NOT NULL,
      file TEXT NOT NULL,
      ident TEXT NOT NULL,
      text TEXT NOT NULL,
      keys TEXT NOT NULL DEFAULT '',
      subject TEXT,
      facet TEXT,
      kind TEXT NOT NULL DEFAULT 'state',
      happened_start TEXT,
      happened_end TEXT,
      valid_from TEXT,
      valid_until TEXT,
      learned_at INTEGER NOT NULL,
      retired_at INTEGER,
      status TEXT NOT NULL,
      replaced_by TEXT,
      links TEXT,
      source TEXT NOT NULL,
      quote TEXT,
      refs TEXT,
      trust TEXT NOT NULL,
      typed INTEGER NOT NULL DEFAULT 0,
      embedding BLOB,
      embed_model TEXT,
      UNIQUE (owner, file, ident)
    );
    CREATE INDEX IF NOT EXISTS memory_facts_owner_status ON memory_facts(owner, status);
    CREATE INDEX IF NOT EXISTS memory_facts_unembedded ON memory_facts(owner) WHERE embedding IS NULL;
    CREATE TABLE IF NOT EXISTS memory_fact_files (
      owner TEXT NOT NULL,
      file TEXT NOT NULL,
      stamp TEXT NOT NULL,
      PRIMARY KEY (owner, file)
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS memory_facts_fts USING fts5(
      text, keys, content='memory_facts', content_rowid='rowid', tokenize='porter unicode61'
    );
    CREATE TRIGGER IF NOT EXISTS memory_facts_ai AFTER INSERT ON memory_facts BEGIN
      INSERT INTO memory_facts_fts(rowid, text, keys) VALUES (new.rowid, new.text, new.keys);
    END;
    CREATE TRIGGER IF NOT EXISTS memory_facts_ad AFTER DELETE ON memory_facts BEGIN
      INSERT INTO memory_facts_fts(memory_facts_fts, rowid, text, keys) VALUES ('delete', old.rowid, old.text, old.keys);
    END;
    CREATE TRIGGER IF NOT EXISTS memory_facts_au AFTER UPDATE OF text, keys ON memory_facts BEGIN
      INSERT INTO memory_facts_fts(memory_facts_fts, rowid, text, keys) VALUES ('delete', old.rowid, old.text, old.keys);
      INSERT INTO memory_facts_fts(rowid, text, keys) VALUES (new.rowid, new.text, new.keys);
    END;
  `);
}
