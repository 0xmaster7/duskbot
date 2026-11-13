import { DurableObject } from "cloudflare:workers";

import { CAP_BYTES_PER_S, accountReport, monthOf } from "./fair-use.js";

/** the ops roll-up hears from an account at most this often */
const ROLLUP_MS = 60_000;

/** one dusk account's relay month: bytes, its active tunnels and the rate they share */
export class AccountUsage extends DurableObject {
  async load() {
    if (this.state === undefined) this.state = (await this.ctx.storage.get("usage")) ?? null;
    return this.state;
  }

  async report({ acct, tunnel, bytes }) {
    const t = Date.now();
    const { state, answer } = accountReport(await this.load(), { tunnel, bytes, t });
    this.state = state;
    await this.ctx.storage.put("usage", state);
    if (!this.rolledAt || t - this.rolledAt >= ROLLUP_MS || (answer.accountRate < CAP_BYTES_PER_S && !this.rolledSlow)) {
      this.rolledAt = t;
      this.rolledSlow = answer.accountRate < CAP_BYTES_PER_S;
      const ops = this.env.OPS;
      try { await ops.get(ops.idFromName("ops")).upsert({ acct, month: state.month, bytes: state.bytes, rate: answer.accountRate, tunnels: answer.active, slowedAt: state.slowedAt, t }); }
      catch { this.rolledAt = 0; }
    }
    return answer;
  }

  async usage() {
    const state = await this.load();
    const month = monthOf(Date.now());
    return state && state.month === month ? state : { month, bytes: 0, tunnels: {}, slowedAt: null };
  }
}

/** every account's month in one table, for the admin ops page */
export class OpsUsage extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS usage (acct TEXT NOT NULL, month TEXT NOT NULL, bytes INTEGER NOT NULL, rate INTEGER NOT NULL,
      tunnels INTEGER NOT NULL, slowed_at INTEGER, updated_at INTEGER NOT NULL, PRIMARY KEY (acct, month))`);
    ctx.storage.sql.exec("CREATE INDEX IF NOT EXISTS usage_month_bytes ON usage (month, bytes DESC)");
  }

  upsert({ acct, month, bytes, rate, tunnels, slowedAt, t }) {
    this.ctx.storage.sql.exec(`INSERT INTO usage (acct, month, bytes, rate, tunnels, slowed_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (acct, month) DO UPDATE SET bytes = excluded.bytes, rate = excluded.rate, tunnels = excluded.tunnels, slowed_at = excluded.slowed_at, updated_at = excluded.updated_at`,
    acct, month, bytes, rate, tunnels, slowedAt ?? null, t);
  }

  top({ month, limit }) {
    const accounts = this.ctx.storage.sql.exec("SELECT acct, bytes, rate, tunnels, slowed_at AS slowedAt, updated_at AS updatedAt FROM usage WHERE month = ? ORDER BY bytes DESC LIMIT ?", month, limit).toArray();
    const [totals] = this.ctx.storage.sql.exec("SELECT COUNT(*) AS accounts, COALESCE(SUM(bytes), 0) AS bytes, COALESCE(SUM(CASE WHEN rate < ? THEN 1 ELSE 0 END), 0) AS slowed FROM usage WHERE month = ?", CAP_BYTES_PER_S, month).toArray();
    return { month, totals, accounts };
  }
}
