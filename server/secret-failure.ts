// Whether a saved secret failing when used proves it wrong. Only a clear auth failure removes it from the Vault; a
// rate limit, a network fault, a CAPTCHA or "try again later" never does, and anything unclear is only marked to check.

/** invalid: the service said the secret itself is wrong. check: it failed, but not provably for that. transient: it may
 * work on a later try. */
export type SecretVerdict = "invalid" | "check" | "transient";

const TRANSIENT = /rate[ _-]?limit|too many|try (?:again )?later|again (?:later|in a)|temporar|timed? ?out|timeout|network|connection|socket|econn|enotfound|eai_again|dns|unavailable|overloaded|bad gateway|gateway time|internal server error|server error|something went wrong|unusual (?:activity|traffic)|captcha|robot|are human|you(?:'| a)re human|slow down|before (?:you )?try(?:ing)? again|wait (?:a|\d+) (?:few |couple of )?(?:moments?|minutes?|seconds?|hours?)/iu;
// failed, but the secret may be fine: billing, a locked account, a code that only went stale
const CHECK = /quota|billing|\bcredits?\b|payment|upgrade|\blocked|suspended|disabled account|account (?:is |has been )?disabled|deactivated|expired code|code (?:has )?expired/iu;

const WRONG = String.raw`(?:incorrect|wrong|invalid|not valid|isn'?t (?:right|valid|correct)|is not (?:right|valid|correct)|not correct|did ?n[o']?t match|does ?n[o']?t match|do not match|not recogni[sz]ed)`;
const KEY = String.raw`(?:api[ _-]?key|access[ _-]?key|secret[ _-]?key|key|token|credentials?|secret|auth)`;
const API_INVALID = new RegExp([
  String.raw`(?:invalid|incorrect|wrong|revoked|expired|deleted|malformed|unknown|bad)[ _-]?${KEY}`,
  String.raw`${KEY}.{0,30}(?:${WRONG}|revoked|expired|(?:was|has been) deleted|not found|disabled)`,
  String.raw`unauthori[sz]ed|unauthenticated|authentication (?:failed|error)|invalid_api_key|invalid_auth|not_authed|bad credentials`,
].join("|"), "iu");

const ACCOUNT = String.raw`(?:password|passcode|credentials|user ?name|e-?mail|login|details|account)`;
const LOGIN_INVALID = new RegExp([
  String.raw`${WRONG}.{0,40}${ACCOUNT}`,
  String.raw`${ACCOUNT}.{0,40}${WRONG}`,
  String.raw`could ?n[o']?t find (?:your|an|that|this)(?: [\w-]+)? account|no account (?:found|with|exists)|account (?:does not|doesn'?t) exist|authentication failed`,
].join("|"), "iu");
const CODE = String.raw`(?:code|token|otp|passcode|verification)`;
const CODE_INVALID = new RegExp([
  String.raw`(?:${WRONG}|did ?n[o']?t work).{0,30}${CODE}`,
  String.raw`${CODE}.{0,30}(?:${WRONG}|did ?n[o']?t work|failed)`,
].join("|"), "iu");

/** What a service answered when a saved API key or token was used: a status code and its message, either may be missing. */
export function classifyApiFailure(failure: { status?: number; message?: string }): SecretVerdict {
  const message = (failure.message ?? "").slice(0, 600);
  const status = failure.status ?? statusIn(message);
  if (status === 408 || status === 425 || status === 429 || (status !== undefined && status >= 500)) return "transient";
  if (TRANSIENT.test(message)) return "transient";
  if (CHECK.test(message)) return "check";
  if (status === 401) return "invalid";
  // a 403 is as often "this key may not do that" as "this key is wrong": only its words decide
  return API_INVALID.test(message) ? "invalid" : "check";
}

/** A status code written in an error's text, such as "HTTP 401" or "401 Unauthorized". */
export function statusIn(message: string): number | undefined {
  const found = /(?:^|[^\d.])([45]\d\d)(?![\d.])/u.exec(message);
  return found ? Number(found[1]) : undefined;
}

/** A site that did not accept a saved login: `step` is what was refused (the username and password, or a one-time code
 * from the saved 2FA key), `alert` the error line the page showed, if any. */
export function classifyLoginFailure(failure: { step: "login" | "code"; alert: string }): SecretVerdict {
  const alert = failure.alert.slice(0, 300);
  if (!alert.trim()) return "check";
  if (TRANSIENT.test(alert)) return "transient";
  if (CHECK.test(alert)) return "check";
  if (failure.step === "code") return CODE_INVALID.test(alert) ? "invalid" : "check";
  return LOGIN_INVALID.test(alert) ? "invalid" : "check";
}
