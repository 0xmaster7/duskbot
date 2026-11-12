// Device sign-in (RFC 8628) to dusk bot's own GitHub App and Google client: the person types a short code on the
// vendor's page, so nothing needs a callback URL and neither app needs a review. GitHub App device tokens refresh with
// the client id alone; Google's device flow needs its installed-app secret, which is not confidential (Google's docs).
// Google allows only drive.file and drive.appdata among Drive scopes for this flow; dusk bot asks for drive.file only.

export type DeviceApp = "github" | "googledrive";

export interface DeviceClient {
  clientId: string;
  clientSecret?: string;
}

export interface DeviceClients {
  github: DeviceClient | null;
  googledrive: DeviceClient | null;
}

/** JSON of the three client values, set by scripts/bundle-server.mjs from the release environment; absent from source. */
declare const DUSK_BUILD_DEVICE_CLIENTS: string | undefined;

function built(): Record<string, string> {
  try {
    return typeof DUSK_BUILD_DEVICE_CLIENTS === "string" ? JSON.parse(DUSK_BUILD_DEVICE_CLIENTS) as Record<string, string> : {};
  } catch {
    return {};
  }
}

/** The clients this build may use: DUSK_GITHUB_APP_CLIENT_ID, DUSK_GOOGLE_DRIVE_CLIENT_ID and DUSK_GOOGLE_DRIVE_CLIENT_SECRET
 * from the environment, else as the release was built with them. Unset leaves that sign-in off; a pasted token still works. */
export function deviceClients(env: NodeJS.ProcessEnv = process.env, baked: Record<string, string> = built()): DeviceClients {
  const value = (name: string) => (env[name] ?? baked[name])?.trim();
  const github = value("DUSK_GITHUB_APP_CLIENT_ID");
  const googleId = value("DUSK_GOOGLE_DRIVE_CLIENT_ID");
  const googleSecret = value("DUSK_GOOGLE_DRIVE_CLIENT_SECRET");
  return {
    github: github ? { clientId: github } : null,
    googledrive: googleId && googleSecret ? { clientId: googleId, clientSecret: googleSecret } : null,
  };
}

const ENDPOINTS: Record<DeviceApp, { code: string; token: string; scope: string }> = {
  github: { code: "https://github.com/login/device/code", token: "https://github.com/login/oauth/access_token", scope: "" },
  googledrive: { code: "https://oauth2.googleapis.com/device/code", token: "https://oauth2.googleapis.com/token", scope: "https://www.googleapis.com/auth/drive.file" },
};

export interface DeviceCode {
  deviceCode: string;
  userCode: string;
  verificationUrl: string;
  expiresIn: number;
  interval: number;
}

export interface DeviceTokens {
  token: string;
  refresh?: string;
  /** Unix ms, when the token says it expires. */
  expiresAt?: number;
}

export type DeviceAnswer = { status: "waiting"; slowDown?: boolean } | { status: "done"; tokens: DeviceTokens } | { status: "failed"; message: string };

const form = (values: Record<string, string | undefined>) => {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value) body.set(key, value);
  return body.toString();
};

async function post(fetchImpl: typeof fetch, url: string, values: Record<string, string | undefined>) {
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
    body: form(values),
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.json().catch(() => null) as Record<string, unknown> | null;
  return { ok: response.ok, body: body ?? {} };
}

export async function startDevice(app: DeviceApp, client: DeviceClient, fetchImpl: typeof fetch = fetch): Promise<DeviceCode> {
  const { body } = await post(fetchImpl, ENDPOINTS[app].code, { client_id: client.clientId, scope: ENDPOINTS[app].scope || undefined });
  const url = body.verification_uri ?? body.verification_url;
  if (typeof body.device_code !== "string" || typeof body.user_code !== "string" || typeof url !== "string" || !url.startsWith("https://")) {
    throw new Error(typeof body.error_description === "string" ? body.error_description : "The sign-in didn't start. Try again.");
  }
  return { deviceCode: body.device_code, userCode: body.user_code, verificationUrl: url, expiresIn: Number(body.expires_in) || 900, interval: Math.max(5, Number(body.interval) || 5) };
}

function tokensOf(body: Record<string, unknown>, now: number): DeviceTokens | null {
  if (typeof body.access_token !== "string" || !body.access_token) return null;
  const expires = Number(body.expires_in);
  return {
    token: body.access_token,
    ...(typeof body.refresh_token === "string" && body.refresh_token ? { refresh: body.refresh_token } : {}),
    ...(Number.isFinite(expires) && expires > 0 ? { expiresAt: now + expires * 1000 } : {}),
  };
}

export async function pollDevice(app: DeviceApp, client: DeviceClient, deviceCode: string, fetchImpl: typeof fetch = fetch, now = Date.now()): Promise<DeviceAnswer> {
  const { body } = await post(fetchImpl, ENDPOINTS[app].token, {
    client_id: client.clientId, client_secret: client.clientSecret, device_code: deviceCode, grant_type: "urn:ietf:params:oauth:grant-type:device_code",
  });
  const tokens = tokensOf(body, now);
  if (tokens) return { status: "done", tokens };
  if (body.error === "authorization_pending") return { status: "waiting" };
  if (body.error === "slow_down") return { status: "waiting", slowDown: true };
  if (body.error === "access_denied") return { status: "failed", message: "The sign-in was cancelled." };
  if (body.error === "expired_token") return { status: "failed", message: "The code expired. Start again." };
  return { status: "failed", message: "The sign-in didn't finish. Start again." };
}

/** A new token from a refresh token; each GitHub refresh token works once, so the answer carries the next one. */
export async function refreshDevice(app: DeviceApp, client: DeviceClient, refresh: string, fetchImpl: typeof fetch = fetch, now = Date.now()): Promise<DeviceTokens> {
  const { body } = await post(fetchImpl, ENDPOINTS[app].token, { client_id: client.clientId, client_secret: client.clientSecret, refresh_token: refresh, grant_type: "refresh_token" });
  const tokens = tokensOf(body, now);
  if (!tokens) throw new Error("The sign-in expired. Connect the app again.");
  return { ...tokens, refresh: tokens.refresh ?? refresh };
}
