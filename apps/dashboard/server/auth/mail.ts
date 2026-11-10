export interface MailMessage { to: string; subject: string; text: string; html: string }
export interface Mailer { send(message: MailMessage): Promise<void> }

export function memoryMailer() {
  const outbox: MailMessage[] = [];
  return { outbox, async send(message: MailMessage) { outbox.push(message); } };
}
export function consoleMailer(): Mailer {
  return { async send(message) { console.log(`code for ${message.to}: ${message.text.match(/\b\d{8}\b/)?.[0] ?? ""}`); } };
}
export function resendMailer(options: { apiKey: string; from: string; fetch?: typeof fetch }): Mailer {
  const request = options.fetch ?? fetch;
  return { async send(message) {
    try {
      const response = await request("https://api.resend.com/emails", { method: "POST", redirect: "error", signal: AbortSignal.timeout(15_000),
        headers: { authorization: `Bearer ${options.apiKey}`, "content-type": "application/json" }, body: JSON.stringify({ from: options.from, ...message }) });
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
  if (provider === "console" && dev) return consoleMailer();
  throw new Error("Configure DUSK_MAIL_PROVIDER=resend for email delivery; console mail is allowed only in development.");
}
export function codeMessage(to: string, code: string): MailMessage {
  return { to, subject: "Your Dusk Bot code", text: `Your Dusk Bot code is ${code}. It expires in 10 minutes.`,
    html: `<p>Your Dusk Bot code is <strong>${code}</strong>.</p><p>It expires in 10 minutes.</p>` };
}
