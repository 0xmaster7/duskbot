import { afterEach, describe, expect, it, vi } from "vitest";
import { codeMessage, consoleMailer, mailerFromEnv, memoryMailer, resendMailer } from "./mail.ts";

afterEach(() => vi.restoreAllMocks());

describe("account mail", () => {
  it("keeps code messages in the fixture outbox", async () => {
    const mailer = memoryMailer(), message = codeMessage("fixture@example.test", "01234567");
    await mailer.send(message);
    expect(mailer.outbox).toEqual([message]);
    expect(message.subject).toBe("Your OpenMausBot code");
    expect(message.text).toContain("01234567"); expect(message.html).toContain("01234567");
    expect(message.text).toContain("It expires in 10 minutes."); expect(message.html).toContain("It expires in 10 minutes.");
  });
  it("prints development codes only through the console mailer", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await consoleMailer().send(codeMessage("fixture@example.test", "01234567"));
    expect(log).toHaveBeenCalledWith("code for fixture@example.test: 01234567");
  });
  it("posts messages to Resend with bearer authentication", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status: 200 }));
    const message = codeMessage("fixture@example.test", "01234567");
    await resendMailer({ apiKey: "fixture-key", from: "Fixture <mail@example.test>", fetch: request }).send(message);
    expect(request).toHaveBeenCalledWith("https://api.resend.com/emails", expect.objectContaining({ method: "POST", redirect: "error",
      headers: { authorization: "Bearer fixture-key", "content-type": "application/json" }, body: JSON.stringify({ from: "Fixture <mail@example.test>", ...message }) }));
  });
  it.each([400, 401, 429, 500])("hides Resend failure details for status %s", async status => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response("sensitive provider details", { status }));
    await expect(resendMailer({ apiKey: "fixture-key", from: "mail@example.test", fetch: request }).send(codeMessage("fixture@example.test", "01234567"))).rejects.toThrow("Email delivery failed.");
  });
  it("hides network errors and never logs provider secrets", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const request = vi.fn<typeof fetch>().mockRejectedValue(new Error("sensitive request details"));
    await expect(resendMailer({ apiKey: "fixture-key", from: "mail@example.test", fetch: request }).send(codeMessage("fixture@example.test", "01234567"))).rejects.toThrow("Email delivery failed.");
    expect(log).not.toHaveBeenCalled();
  });
  it("validates mail configuration at startup and restricts console mail to development", () => {
    expect(mailerFromEnv({}, { dev: true })).toHaveProperty("send");
    expect(() => mailerFromEnv({}, { dev: false })).toThrow("Configure OMB_MAIL_PROVIDER=resend");
    expect(() => mailerFromEnv({ OMB_MAIL_PROVIDER: "console" }, { dev: false })).toThrow("console mail is allowed only in development");
    expect(() => mailerFromEnv({ OMB_MAIL_PROVIDER: "other" }, { dev: true })).toThrow();
    expect(() => mailerFromEnv({ OMB_MAIL_PROVIDER: "resend" }, { dev: true })).toThrow("OMB_RESEND_API_KEY and OMB_MAIL_FROM");
    expect(() => mailerFromEnv({ OMB_MAIL_PROVIDER: "resend", OMB_RESEND_API_KEY: "fixture-key" }, { dev: false })).toThrow("OMB_MAIL_FROM");
    expect(mailerFromEnv({ OMB_MAIL_PROVIDER: "resend", OMB_RESEND_API_KEY: "fixture-key", OMB_MAIL_FROM: "mail@example.test" }, { dev: false })).toHaveProperty("send");
  });
});
