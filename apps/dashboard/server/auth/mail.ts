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
/** `from` is "Name <address>" or a bare address */
export function brevoMailer(options: { apiKey: string; from: string; fetch?: typeof fetch }): Mailer {
  const request = options.fetch ?? fetch;
  const named = options.from.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  const sender = named ? { name: named[1] || undefined, email: named[2] } : { email: options.from.trim() };
  return { async send(message) {
    try {
      const response = await request("https://api.brevo.com/v3/smtp/email", { method: "POST", redirect: "error", signal: AbortSignal.timeout(15_000),
        headers: { "api-key": options.apiKey, "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ sender, to: [{ email: message.to }], subject: message.subject, textContent: message.text, htmlContent: message.html }) });
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
export function codeMessage(to: string, code: string): MailMessage {
  return { to, subject: "Your Dusk Bot code", text: `Your Dusk Bot code is ${code}. It expires in 10 minutes.`,
    html: `<p>Your Dusk Bot code is <strong>${code}</strong>.</p><p>It expires in 10 minutes.</p>` };
}
const WAYS: Record<string, string> = { email: "an emailed code", google: "Google", apple: "Apple", x: "X" };
const escape = (value: string) => value.replace(/[&<>"']/g, char => `&#${char.charCodeAt(0)};`);
/** "Can't sign in?": the code (and, for the website, a one-time link), plus the ways this address signs in. `ways` null: no
 * account uses the address, so no code goes out, only that answer. */
export function recoveryMessage(to: string, { code, link = null, ways }: { code: string; link?: string | null; ways: string[] | null }): MailMessage {
  if (!ways) {
    const text = "Someone asked to sign in to Dusk Bot with this address, but no Dusk Bot account uses it. Try another address you use. If you did not ask, you can ignore this email.";
    return { to, subject: "Signing in to Dusk Bot", text, html: `<p>${text}</p>` };
  }
  const named = ways.map(way => WAYS[way] ?? way);
  const list = named.length > 1 ? `${named.slice(0, -1).join(", ")} or ${named.at(-1)}` : named[0] ?? WAYS.email;
  const lines = [`Your Dusk Bot code is ${code}. It expires in 10 minutes.`, ...(link ? [`Or open this link to sign in: ${link}`] : []),
    `This account signs in with ${list}.`, "If you did not ask, you can ignore this email; nothing changes."];
  return { to, subject: "Sign in to Dusk Bot", text: lines.join("\n\n"),
    html: [`<p>Your Dusk Bot code is <strong>${code}</strong>. It expires in 10 minutes.</p>`, ...(link ? [`<p><a href="${escape(link)}">Sign in to Dusk Bot</a></p>`] : []),
      `<p>This account signs in with ${escape(list)}.</p>`, "<p>If you did not ask, you can ignore this email; nothing changes.</p>"].join("") };
}
