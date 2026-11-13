import { describe, expect, it } from "vitest";

import { classifyApiFailure, classifyLoginFailure, statusIn } from "./secret-failure.ts";

describe("a saved API key that failed when used", () => {
  it("is wrong on a clear auth failure", () => {
    for (const message of [
      "HTTP 401 Unauthorized",
      "401: {\"error\":{\"message\":\"Incorrect API key provided\"}}",
      "Error: invalid_api_key",
      "403 Forbidden: API key revoked",
      "The access token expired",
      "Bad credentials",
      "API key not valid. Please pass a valid API key.",
    ]) expect(classifyApiFailure({ message }), message).toBe("invalid");
    expect(classifyApiFailure({ status: 401 })).toBe("invalid");
  });

  it("is never wrong on a rate limit, a network fault, a busy service or try again later", () => {
    for (const message of [
      "HTTP 429 Too Many Requests",
      "rate_limit_exceeded",
      "503 Service Unavailable",
      "fetch failed: ECONNRESET",
      "getaddrinfo ENOTFOUND api.example.com",
      "Request timed out",
      "Something went wrong, please try again later",
      "401 Unauthorized, try again in a few minutes",
    ]) expect(classifyApiFailure({ message }), message).toBe("transient");
    expect(classifyApiFailure({ status: 502 })).toBe("transient");
  });

  it("is only to check when it may be fine: a bare 403, billing, or words that prove nothing", () => {
    for (const message of [
      "403 Forbidden",
      "This key may not access this project",
      "insufficient_quota: you exceeded your current quota",
      "it didn't work",
      "",
    ]) expect(classifyApiFailure({ message }), message).toBe("check");
  });

  it("reads a status code from an error's words, not from a version or a size", () => {
    expect(statusIn("HTTP 401 Unauthorized")).toBe(401);
    expect(statusIn("status=403")).toBe(403);
    expect(statusIn("v1.401.2 build")).toBeUndefined();
    expect(statusIn("sent 4012 bytes")).toBeUndefined();
  });
});

describe("a saved login a site refused", () => {
  it("is wrong when the site says the password or account is wrong", () => {
    for (const alert of [
      "Sorry, your password was incorrect. Please double-check your password.",
      "Incorrect username or password.",
      "The email or password you entered isn't right",
      "Wrong password. Try again or click Forgot password to reset it.",
      "Couldn't find your Google Account",
      "Invalid credentials",
    ]) expect(classifyLoginFailure({ step: "login", alert }), alert).toBe("invalid");
  });

  it("is never wrong on a CAPTCHA, a lockout for too many tries or try again later", () => {
    for (const alert of [
      "Too many incorrect password attempts. Try again later.",
      "Please wait a few minutes before you try again.",
      "We detected unusual activity. Please complete the captcha.",
      "Something went wrong. Please try again.",
      "Network error",
    ]) expect(classifyLoginFailure({ step: "login", alert }), alert).toBe("transient");
  });

  it("is only to check with no error line, a locked account, or words that prove nothing", () => {
    expect(classifyLoginFailure({ step: "login", alert: "" })).toBe("check");
    expect(classifyLoginFailure({ step: "login", alert: "Your account has been locked" })).toBe("check");
    expect(classifyLoginFailure({ step: "login", alert: "Sign in failed" })).toBe("check");
  });

  it("finds a 2FA key wrong only when its code is refused in words, and a stale code only to check", () => {
    expect(classifyLoginFailure({ step: "code", alert: "That code is incorrect" })).toBe("invalid");
    expect(classifyLoginFailure({ step: "code", alert: "Invalid verification code" })).toBe("invalid");
    expect(classifyLoginFailure({ step: "code", alert: "The code has expired" })).toBe("check");
    expect(classifyLoginFailure({ step: "code", alert: "" })).toBe("check");
    expect(classifyLoginFailure({ step: "code", alert: "Too many attempts, try again later" })).toBe("transient");
  });
});
