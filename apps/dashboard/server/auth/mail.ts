import { codeEmail, emailConfig, recoveryEmail } from "../email/templates.ts";
import type { EmailConfig } from "../email/templates.ts";
export interface MailMessage { to: string; subject: string; text: string; html: string }
export interface Mailer { send(message: MailMessage): Promise<void> }

export function memoryMailer() {
  const outbox: MailMessage[] = [];
  return { outbox, async send(message: MailMessage) { outbox.push(message); } };
}
export function consoleMailer(): Mailer {
  return { async send(message) { console.log(`code for ${message.to}: ${message.text.match(/\b\d{8}\b/)?.[0] ?? ""}`); } };
}
export const REPLY_TO = "hello@dusk.bot";
export const SENDER_NAME = "dusk bot";
/** the address out of "Name <address>" or a bare address; every email goes out under the name "dusk bot" */
export const senderAddress = (from: string) => (from.match(/<([^>]+)>\s*$/)?.[1] ?? from).trim();
export function resendMailer(options: { apiKey: string; from: string; fetch?: typeof fetch }): Mailer {
  const request = options.fetch ?? fetch;
  return { async send(message) {
    try {
      const response = await request("https://api.resend.com/emails", { method: "POST", redirect: "error", signal: AbortSignal.timeout(15_000),
        headers: { authorization: `Bearer ${options.apiKey}`, "content-type": "application/json" }, body: JSON.stringify({ from: `${SENDER_NAME} <${senderAddress(options.from)}>`, reply_to: REPLY_TO, ...message }) });
      await response.body?.cancel();
      if (!response.ok) throw new Error();
    } catch { throw new Error("Email delivery failed."); }
  } };
}
export function brevoMailer(options: { apiKey: string; from: string; fetch?: typeof fetch }): Mailer {
  const request = options.fetch ?? fetch;
  const sender = { name: SENDER_NAME, email: senderAddress(options.from) };
  return { async send(message) {
    try {
      const response = await request("https://api.brevo.com/v3/smtp/email", { method: "POST", redirect: "error", signal: AbortSignal.timeout(15_000),
        headers: { "api-key": options.apiKey, "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ sender, replyTo: { email: REPLY_TO }, to: [{ email: message.to }], subject: message.subject, textContent: message.text, htmlContent: message.html }) });
      await response.body?.cancel();
      if (!response.ok) throw new Error();
    } catch { throw new Error("Email delivery failed."); }
  } };
}
export function mailerFromEnv(env: NodeJS.ProcessEnv, { dev }: { dev: boolean }): Mailer {
  const provider = env.DUSK_MAIL_PROVIDER ?? (dev ? "console" : "");
  if (provider === "resend") {
    if (!env.DUSK_RESEND_API_KEY || !env.DUSK_MAIL_FROM) throw new Error("DUSK_MAIL_PROVIDER=resend requires DUSK_RESEND_API_KEY and DUSK_MAIL_FROM.");
    return resendMailer({ apiKey: env.DUSK_RESEND_API_KEY, from: env.DUSK_MAIL_FROM });
  }
  if (provider === "brevo") {
    if (!env.DUSK_BREVO_API_KEY || !env.DUSK_MAIL_FROM) throw new Error("DUSK_MAIL_PROVIDER=brevo requires DUSK_BREVO_API_KEY and DUSK_MAIL_FROM.");
    return brevoMailer({ apiKey: env.DUSK_BREVO_API_KEY, from: env.DUSK_MAIL_FROM });
  }
  if (provider === "console" && dev) return consoleMailer();
  throw new Error("Configure DUSK_MAIL_PROVIDER=brevo or resend for email delivery; console mail is allowed only in development.");
}
export function codeMessage(to: string, code: string, cfg: EmailConfig = emailConfig(process.env, { publicUrl: "https://dusk.bot" })): MailMessage {
  return { to, ...codeEmail(cfg, { code }) };
}
/** "Can't sign in?": the code (and, for the website, a one-time link), plus the ways this address signs in. `ways` null: no
 * account uses the address, so no code goes out, only that answer. */
export function recoveryMessage(to: string, input: { code: string; link?: string | null; ways: string[] | null },
  cfg: EmailConfig = emailConfig(process.env, { publicUrl: "https://dusk.bot" })): MailMessage {
  return { to, ...recoveryEmail(cfg, input) };
}
