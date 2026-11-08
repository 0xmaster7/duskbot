import { createHash, createPrivateKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { OAUTH_PROVIDERS, type OAuthProvider } from "../../../shared/account-api.ts";
import { createJwtVerifier, fetchJson, signEs256Jwt } from "./jwt.ts";

export interface ProviderConfig {
  clientId: string; clientSecret?: string; authorizeUrl: string; tokenUrl: string; jwksUrl?: string; issuers?: string[]; userUrl?: string; scopes: string;
  apple?: { teamId: string; keyId: string; privateKey: string };
}
export type ProviderConfigs = Partial<Record<OAuthProvider, ProviderConfig>>;
export interface ProviderProfile { subject: string; email: string | null; label: string | null; name: string | null }
export interface Provider {
  id: OAuthProvider;
  authorize(input: { state: string; nonce: string; verifier: string; redirectUri: string }): string;
  profile(input: { code: string; nonce: string; verifier: string; redirectUri: string; user?: string }): Promise<ProviderProfile>;
}
const defaults = {
  google: { authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth", tokenUrl: "https://oauth2.googleapis.com/token", jwksUrl: "https://www.googleapis.com/oauth2/v3/certs", issuers: ["https://accounts.google.com", "accounts.google.com"], scopes: "openid email profile" },
  apple: { authorizeUrl: "https://appleid.apple.com/auth/authorize", tokenUrl: "https://appleid.apple.com/auth/token", jwksUrl: "https://appleid.apple.com/auth/keys", issuers: ["https://appleid.apple.com"], scopes: "name email" },
  x: { authorizeUrl: "https://x.com/i/oauth2/authorize", tokenUrl: "https://api.x.com/2/oauth2/token", userUrl: "https://api.x.com/2/users/me?user.fields=confirmed_email", scopes: "users.read tweet.read" },
};
const text = (value: unknown, max: number) => typeof value === "string" && value.trim() && value.trim().length <= max && !/[\x00-\x1f\x7f]/.test(value) ? value.trim() : null;
function email(value: unknown) {
  const address = text(value, 254)?.toLowerCase();
  return address && /^[^\s@]{1,64}@[^\s@.]+(?:\.[^\s@.]+)+$/.test(address) ? address : null;
}
export function createProviderRegistry(configs: ProviderConfigs = {}, options: { fetch?: typeof fetch; now?: () => number } = {}) {
  const request = options.fetch ?? fetch, now = options.now ?? Date.now, verifyJwt = createJwtVerifier(options);
  const registry = new Map<OAuthProvider, Provider>();
  for (const id of OAUTH_PROVIDERS) {
    const config = configs[id];
    if (!config) continue;
    registry.set(id, { id,
      authorize({ state, nonce, verifier, redirectUri }) {
        const url = new URL(config.authorizeUrl);
        const params = { client_id: config.clientId, redirect_uri: redirectUri, response_type: "code", scope: config.scopes, state };
        for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
        if (id === "apple") url.searchParams.set("response_mode", "form_post");
        else { url.searchParams.set("code_challenge", createHash("sha256").update(verifier).digest("base64url")); url.searchParams.set("code_challenge_method", "S256"); }
        if (id !== "x") url.searchParams.set("nonce", nonce);
        return url.href;
      },
      async profile({ code, nonce, verifier, redirectUri, user }) {
        const body = new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri });
        const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded" };
        if (id === "x" && config.clientSecret) headers.authorization = `Basic ${Buffer.from(`${encodeURIComponent(config.clientId)}:${encodeURIComponent(config.clientSecret)}`).toString("base64")}`;
        else body.set("client_id", config.clientId);
        if (id !== "apple") body.set("code_verifier", verifier);
        if (id === "apple") {
          if (!config.apple) throw new Error("Apple signing configuration is missing.");
          const iat = Math.floor(now() / 1000);
          body.set("client_secret", signEs256Jwt({ alg: "ES256", kid: config.apple.keyId }, { iss: config.apple.teamId, iat, exp: iat + 600, aud: "https://appleid.apple.com", sub: config.clientId }, config.apple.privateKey));
        } else if (id === "google" && config.clientSecret) body.set("client_secret", config.clientSecret);
        const tokens = await fetchJson(request, config.tokenUrl, { method: "POST", headers, body: body.toString() });
        if (id === "x") {
          if (typeof tokens.access_token !== "string" || !tokens.access_token || !config.userUrl) throw new Error("Invalid provider token.");
          const result = await fetchJson(request, config.userUrl, { headers: { authorization: `Bearer ${tokens.access_token}` } });
          const data = result.data as Record<string, unknown> | undefined;
          if (!data || !text(data.id, 256)) throw new Error("Invalid provider subject.");
          return { subject: data.id as string, email: email(data.confirmed_email), label: text(data.username, 100), name: text(data.name, 80) };
        }
        if (typeof tokens.id_token !== "string" || !config.jwksUrl || !config.issuers) throw new Error("Missing identity token.");
        const claims = await verifyJwt(tokens.id_token, { jwksUrl: config.jwksUrl, issuers: config.issuers, clientId: config.clientId, nonce, algorithms: ["RS256"] });
        if (!text(claims.sub, 256)) throw new Error("Invalid provider subject.");
        let name = id === "google" ? text(claims.name, 80) : null;
        if (id === "apple" && user) {
          const data = JSON.parse(user) as { name?: { firstName?: unknown; lastName?: unknown } };
          name = text([text(data?.name?.firstName, 80), text(data?.name?.lastName, 80)].filter(Boolean).join(" "), 80);
        }
        return { subject: claims.sub as string, email: claims.email_verified === true || (id === "apple" && claims.email_verified === "true") ? email(claims.email) : null, label: name, name };
      },
    });
  }
  return registry;
}
export function providersFromEnv(env: NodeJS.ProcessEnv): ProviderConfigs {
  const configs: ProviderConfigs = {};
  function required(name: string) {
    const value = env[name];
    if (!value?.trim()) throw new Error(`Missing ${name} for sign-in provider.`);
    return value;
  }
  for (const id of OAUTH_PROVIDERS) {
    const prefix = `OMB_AUTH_${id.toUpperCase()}_`;
    if (!Object.keys(env).some(key => key.startsWith(prefix) && env[key] !== undefined)) continue;
    const clientId = required(`${prefix}CLIENT_ID`);
    if (id === "google") configs.google = { ...defaults.google, clientId, clientSecret: required(`${prefix}CLIENT_SECRET`) };
    else if (id === "x") configs.x = { ...defaults.x, clientId, ...(env.OMB_AUTH_X_CLIENT_SECRET ? { clientSecret: env.OMB_AUTH_X_CLIENT_SECRET } : {}), scopes: env.OMB_AUTH_X_SCOPES?.trim() || defaults.x.scopes };
    else {
      const teamId = required(`${prefix}TEAM_ID`), keyId = required(`${prefix}KEY_ID`);
      let privateKey: string;
      if (env.OMB_AUTH_APPLE_PRIVATE_KEY) privateKey = env.OMB_AUTH_APPLE_PRIVATE_KEY.replace(/\\n/g, "\n");
      else if (env.OMB_AUTH_APPLE_PRIVATE_KEY_FILE) {
        try { privateKey = readFileSync(env.OMB_AUTH_APPLE_PRIVATE_KEY_FILE, "utf8"); } catch { throw new Error("Cannot read OMB_AUTH_APPLE_PRIVATE_KEY_FILE."); }
      } else throw new Error("Missing OMB_AUTH_APPLE_PRIVATE_KEY or OMB_AUTH_APPLE_PRIVATE_KEY_FILE for sign-in provider.");
      try {
        const key = createPrivateKey(privateKey);
        if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") throw new Error();
      } catch { throw new Error("Invalid OMB_AUTH_APPLE_PRIVATE_KEY or OMB_AUTH_APPLE_PRIVATE_KEY_FILE: expected a P-256 private key."); }
      configs.apple = { ...defaults.apple, clientId, apple: { teamId, keyId, privateKey } };
    }
  }
  return configs;
}
