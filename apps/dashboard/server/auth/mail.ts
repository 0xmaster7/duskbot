import { codeEmail, emailConfig, recoveryEmail } from "../email/templates.ts";
import type { EmailConfig } from "../email/templates.ts";
/** textOnly: a transactional email (templates.ts marks codes, receipts and "cloud ready"); providers that track html send only the text */
export interface MailMessage { to: string; subject: string; text: string; html: string; textOnly?: boolean }
export interface Mailer { send(message: MailMessage): Promise<void> }

export function memoryMailer() {
  const outbox: MailMessage[] = [];
  return { outbox, async send(message: MailMessage) { outbox.push(message); } };
}
export function consoleMailer(): Mailer {
  return { async send(message) { console.log(`code for ${message.to}: ${message.text.match(/\b\d{8}\b/)?.[0] ?? ""}`); } };
}
/** test harnesses sign up at <anything>@qa.dusk.test (.test is reserved, RFC 2606): their mail never reaches a provider */
export const TEST_MAIL_DOMAIN = "qa.dusk.test";
// qa@dusk.bot, qa-<x>@dusk.bot and qa+<x>@dusk.bot: older harnesses signed up there, and dusk.bot's catch-all lands in the owner's inbox
const OWN_QA = /^qa(?:[-+._][^@]*)?@dusk\.bot$/;
export const isTestAddress = (email: unknown) => {
  if (typeof email !== "string") return false;
  const address = email.trim().toLowerCase();
  return address.endsWith(`@${TEST_MAIL_DOMAIN}`) || OWN_QA.test(address);
};
// the preview end-to-end runs sign up at a real throwaway inbox (apps/cloud-service/scripts/preview-e2e.ts) to prove a code arrives
const E2E_LOCAL = /^dusk-(?:e2e|appconn)-[a-z0-9]+@/;
/** a harness's account: it gets sign-in codes and links it acts on, never the courtesy mail (welcome, cloud ready, receipts) */
export const isTestAccount = (email: unknown) => isTestAddress(email) || (typeof email === "string" && E2E_LOCAL.test(email.trim().toLowerCase()));
export interface TestMail { to: string; subject: string; code: string | null; link: string | null; at: number }
export interface TestMailbox { readonly readable: boolean; keep(message: MailMessage): void; latest(to: string, since?: number): TestMail | null }
/** where mail to test addresses goes instead. `readable` (preview and dev only) keeps the code and link for a while so
 *  a harness can read them (GET /v1/ops/test-mail); otherwise it is dropped */
export function createTestMailbox({ readable, now = Date.now, ttlMs = 30 * 60_000, max = 500 }: { readable: boolean; now?: () => number; ttlMs?: number; max?: number }): TestMailbox {
  let kept: TestMail[] = [];
  return {
    readable,
    keep(message) {
      if (!readable) return;
      const link = /https:\/\/[^\s"'<>)]+/.exec(message.text)?.[0] ?? null;
      kept = [...kept.filter(item => item.at > now() - ttlMs).slice(-(max - 1)),
        { to: message.to.trim().toLowerCase(), subject: message.subject, code: /\b\d{8}\b/.exec(message.text)?.[0] ?? null, link, at: now() }];
    },
    latest(to, since = 0) {
      const want = to.trim().toLowerCase();
      return [...kept].reverse().find(item => item.to === want && item.at >= since && item.at > now() - ttlMs) ?? null;
    },
  };
}
/** mail to a test address goes to the mailbox, everything else to `inner` */
export function sinkTestMail(inner: Mailer, box: TestMailbox): Mailer {
  return { async send(message) { if (isTestAddress(message.to)) { box.keep(message); return; } return inner.send(message); } };
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
        headers: { authorization: `Bearer ${options.apiKey}`, "content-type": "application/json" }, body: JSON.stringify({ from: `${SENDER_NAME} <${senderAddress(options.from)}>`, reply_to: REPLY_TO, to: message.to, subject: message.subject, text: message.text, ...(message.textOnly ? {} : { html: message.html }) }) });
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
        // a transactional email goes as text only: brevo puts an open pixel and rewritten click links into every html part it
        // relays and can't turn them off below its enterprise plan; both push mail to gmail's promotions tab
        body: JSON.stringify({ sender, replyTo: { email: REPLY_TO }, to: [{ email: message.to }], subject: message.subject, textContent: message.text,
          ...(message.textOnly ? {} : { htmlContent: message.html }) }) });
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
