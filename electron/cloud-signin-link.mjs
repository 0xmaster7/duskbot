import { createHash, randomBytes } from "node:crypto";
import { APP_LINK, APP_START, LINK_PROVIDERS } from "./cloud-signin.mjs";

/** The address to open, and what stays in main: the verifier and the state the link must bring back. */
export function linkSignIn(origin, provider, random = randomBytes) {
  if (!LINK_PROVIDERS.includes(provider)) return null;
  const verifier = random(32).toString("base64url"), state = random(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const query = new URLSearchParams({ provider, code_challenge: challenge, code_challenge_method: "S256", state, redirect_uri: APP_LINK });
  return { url: `${origin}${APP_START}?${query}`, verifier, state };
}
