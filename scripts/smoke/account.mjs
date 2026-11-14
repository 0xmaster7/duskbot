// The smoke's dusk account on the preview account service, signed in through the desktop app's own account client
// (electron/cloud-account.mjs) with a real emailed code. *@dusk.bot mail lands in the team inbox, so the code is read
// from Brevo's transactional log (DUSK_BREVO_API_KEY in the dusk env file, never printed). The session is kept in the
// smoke profile so a run within a day reuses it instead of sending another email.
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const PREVIEW_ORIGIN = "https://preview.dusk.bot";
const FRESH_SIGN_IN_MS = 20 * 60 * 60 * 1000;
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

export function envValue(name, file = process.env.DUSK_ENV_FILE || join(homedir(), ".config", "duskbot", "dusk.env")) {
  if (process.env[name]) return process.env[name];
  if (!existsSync(file)) return null;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match && match[1] === name) return match[2].replace(/^["']|["']$/g, "");
  }
  return null;
}

/** the newest 8-digit sign-in code Brevo sent to `email` after `since` (ms), or null */
export async function brevoCode(email, since) {
  const key = envValue("DUSK_BREVO_API_KEY");
  if (!key) throw new Error("DUSK_BREVO_API_KEY is not set (dusk env file), so the emailed code cannot be read");
  const headers = { "api-key": key, accept: "application/json" };
  const list = await (await fetch(`https://api.brevo.com/v3/smtp/emails?email=${encodeURIComponent(email)}&limit=5&sort=desc`, { headers })).json();
  const items = (list.transactionalEmails ?? []).filter((item) => Date.parse(item.date) >= since - 60_000).sort((a, b) => b.date.localeCompare(a.date));
  for (const item of items) {
    const fromSubject = /\b(\d{8})\b/.exec(item.subject ?? "")?.[1];
    if (fromSubject) return fromSubject;
    const one = await (await fetch(`https://api.brevo.com/v3/smtp/emails/${item.uuid}`, { headers })).json();
    const code = /\b(\d{8})\b/.exec(String(one.body ?? "").replace(/<[^>]+>/g, " "))?.[1];
    if (code) return code;
  }
  return null;
}

/**
 * Signs the smoke account in (or restores today's session). Returns { client, state, how }.
 * root: the checkout whose account client runs. profile: the smoke profile folder.
 */
export async function smokeAccount({ root, profile, email, force = false, appVersion = "0.0.0" }) {
  const { createCloudAccountClient } = await import(pathToFileURL(join(root, "electron", "cloud-account.mjs")).href);
  const file = join(profile, "account-session.json");
  let saved = null;
  try { saved = JSON.parse(readFileSync(file, "utf8")); } catch {}
  const fresh = !force && saved?.email === email && Date.now() - (saved.signedInAt ?? 0) < FRESH_SIGN_IN_MS;
  const store = {
    read: async () => (fresh ? saved.value : null),
    write: async (value) => {
      saved = { email, signedInAt: saved?.email === email && fresh ? saved.signedInAt : Date.now(), value };
      writeFileSync(file, JSON.stringify(saved));
      chmodSync(file, 0o600);
    },
  };
  const client = createCloudAccountClient({ origin: PREVIEW_ORIGIN, platform: process.platform, deviceName: "dusk smoke", appVersion, store, openBrowser: async () => {}, warn: () => {} });
  let state = await client.start();
  if (state?.status === "connected") return { client, state, how: "kept today's session" };
  const since = Date.now();
  const sent = await client.emailStart(email);
  if (sent.outcome !== "sent") throw new Error(`the account service did not send a code (${sent.outcome})`);
  let code = null;
  // Brevo's log lags a minute or two behind the send
  for (let tries = 0; tries < 30 && !code; tries++) { await sleep(8_000); code = await brevoCode(email, since); }
  if (!code) throw new Error("no sign-in code showed up in Brevo's log within four minutes");
  const signed = await client.emailVerify(code);
  if (signed.outcome !== "signed-in") throw new Error(`sign-in with the emailed code failed (${signed.outcome})`);
  state = client.state();
  if (state.status !== "connected") throw new Error(`signed in but the account is ${state.status}`);
  return { client, state, how: "signed in with an emailed code" };
}
