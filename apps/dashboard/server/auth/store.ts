import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import type { OAuthProvider, SessionView } from "../../../../shared/account-api.ts";

export interface Account { id: string; email: string; name: string | null; createdAt: number }
export interface Identity { accountId: string; provider: OAuthProvider; subject: string; email: string | null; label: string | null; addedAt: number }
export interface Session extends Omit<SessionView, "current"> { accountId: string; tokenHash: string }
interface AuthState { accounts: Account[]; identities: Identity[]; sessions: Session[] }

export function createAuthStore(dataDir: string) {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const path = `${dataDir}/auth.json`;
  let state: AuthState = { accounts: [], identities: [], sessions: [] };
  try {
    const loaded = JSON.parse(readFileSync(path, "utf8")) as AuthState;
    if (!Array.isArray(loaded.accounts) || !Array.isArray(loaded.identities) || !Array.isArray(loaded.sessions)) throw new Error("Invalid auth state.");
    state = loaded;
    chmodSync(path, 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  let secret = process.env.DUSK_AUTH_SECRET;
  if (secret !== undefined && secret.length < 32) throw new Error("DUSK_AUTH_SECRET must contain at least 32 characters.");
  if (secret === undefined) {
    const secretPath = `${dataDir}/auth-secret`;
    try { secret = readFileSync(secretPath, "utf8"); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      secret = randomBytes(32).toString("base64url");
      writeFileSync(secretPath, secret, { mode: 0o600, flag: "wx" });
    }
    if (secret.length < 32) throw new Error("Invalid auth secret file.");
    chmodSync(secretPath, 0o600);
  }
  let timer: ReturnType<typeof setTimeout> | null = null;
  function flush() {
    if (timer) clearTimeout(timer);
    timer = null;
    writeFileSync(`${path}.tmp`, JSON.stringify(state), { mode: 0o600 });
    chmodSync(`${path}.tmp`, 0o600);
    renameSync(`${path}.tmp`, path);
  }
  return {
    state, secret,
    changed() {
      if (timer) return;
      timer = setTimeout(flush, 1000);
      timer.unref();
    },
    close: flush,
  };
}
