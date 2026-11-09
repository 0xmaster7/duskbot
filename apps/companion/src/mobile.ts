import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

import { writeFileAtomic } from "./state.ts";

const TOKEN = /^omb_sess_[A-Za-z0-9_-]{20,200}$/;
const hashOf = (token: string): string => createHash("sha256").update(token).digest("hex");

interface MobileSession {
  hash: string;
  deviceId: string;
  createdAt: number;
}

export function createMobileSessions({ file }: { file: string | null }) {
  let sessions: MobileSession[] = [];
  if (file !== null) {
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8"));
      if (parsed?.v !== 1 || !Array.isArray(parsed.sessions) || !parsed.sessions.every(
        (session: MobileSession) => session && typeof session.hash === "string" && /^[a-f0-9]{64}$/.test(session.hash)
          && typeof session.deviceId === "string" && Number.isSafeInteger(session.createdAt)
          && session.createdAt >= 0,
      )) throw new Error("invalid mobile sessions");
      sessions = parsed.sessions
        .map(({ hash, deviceId, createdAt }: MobileSession) => ({ hash, deviceId, createdAt }))
        .sort((a: MobileSession, b: MobileSession) => a.createdAt - b.createdAt).slice(-64);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        console.warn("companion: could not load mobile sessions");
      }
    }
  }

  const persist = (): void => {
    if (file === null) return;
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    writeFileAtomic(file, JSON.stringify({ v: 1, sessions }));
  };

  return {
    remember(token: string, deviceId: string): void {
      if (!TOKEN.test(token)) return;
      const hash = hashOf(token);
      if (sessions.some((session) => session.hash === hash)) return;
      const previous = sessions;
      sessions = [...sessions, { hash, deviceId, createdAt: Date.now() }].slice(-64);
      try {
        persist();
      } catch (error) {
        sessions = previous;
        throw error;
      }
    },
    has(token: string): boolean {
      if (!TOKEN.test(token)) return false;
      const hash = hashOf(token);
      return sessions.some((session) => session.hash === hash);
    },
    forget(token: string): void {
      const hash = hashOf(token);
      const previous = sessions.length;
      sessions = sessions.filter((session) => session.hash !== hash);
      if (sessions.length !== previous) persist();
    },
    list(): { deviceId: string; createdAt: number }[] {
      return sessions.map(({ deviceId, createdAt }) => ({ deviceId, createdAt }));
    },
  };
}
