#!/usr/bin/env node
// Fake of a provider CLI's own sign-in (`copilot login --device-code`, `cursor-agent login`) for connect tests: it prints
// the provider's prompt and then never finishes, approves or declines. No network, no credentials. Env knobs:
//   FAKE_LOGIN_PROVIDER  copilot (default) | cursor
//   FAKE_LOGIN_OUTCOME   never (default) | approve | deny
//   FAKE_LOGIN_MS        how long before approve or deny (default 200)
//   FAKE_LOGIN_DUMP      path: {argv, NO_OPEN_BROWSER} of the login run is written here
//   FAKE_LOGIN_SIGNED_IN path: once it exists, `status` reports a sign-in (cursor-agent status)
import { existsSync, writeFileSync } from "node:fs";

const argv = process.argv.slice(2);
const provider = process.env.FAKE_LOGIN_PROVIDER ?? "copilot";

if (argv.includes("--version")) {
  console.log(provider === "cursor" ? "2026.10.22-fake" : "GitHub Copilot CLI 1.0.106.");
  process.exit(0);
}
if (argv[0] === "status" || argv[0] === "whoami") {
  const signedIn = Boolean(process.env.FAKE_LOGIN_SIGNED_IN && existsSync(process.env.FAKE_LOGIN_SIGNED_IN));
  console.log(JSON.stringify({ isAuthenticated: signedIn }));
  process.exit(0);
}
if (argv[0] === "models") {
  console.log("auto - Auto");
  process.exit(0);
}
if (argv[0] !== "login") {
  console.error(`fake-login-cli: unsupported ${argv.join(" ")}`);
  process.exit(2);
}

if (process.env.FAKE_LOGIN_DUMP) {
  writeFileSync(process.env.FAKE_LOGIN_DUMP, JSON.stringify({ argv, NO_OPEN_BROWSER: process.env.NO_OPEN_BROWSER ?? null }));
}
if (provider === "cursor") {
  console.log("Starting login process...");
  console.log("Open a browser and navigate to this link: https://cursor.com/loginDeepControl?challenge=fakechallenge&uuid=fake-uuid&mode=login&redirectTarget=cli");
} else {
  console.log("To authenticate, visit https://github.com/login/device and enter code FAKE-1234");
  console.log("Waiting for authorization...");
}

const outcome = process.env.FAKE_LOGIN_OUTCOME ?? "never";
const after = Number(process.env.FAKE_LOGIN_MS ?? 200);
if (outcome === "approve") {
  setTimeout(() => {
    if (process.env.FAKE_LOGIN_SIGNED_IN) writeFileSync(process.env.FAKE_LOGIN_SIGNED_IN, "1");
    console.log("Signed in.");
    process.exit(0);
  }, after);
} else if (outcome === "deny") {
  setTimeout(() => { console.error("access_denied: the user declined"); process.exit(1); }, after);
} else {
  setInterval(() => {}, 60_000);
}
