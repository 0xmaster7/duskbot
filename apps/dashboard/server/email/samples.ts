import { accountDeletedEmail, cancelledEmail, cloudDeletedEmail, cloudNoticeEmail, cloudReadyEmail, codeEmail, newDeviceEmail, paymentFailedEmail, promoEmail, receiptEmail,
  recoveryEmail, welcomeEmail } from "./templates.ts";
import type { CloudNoticeKind, EmailConfig, Rendered } from "./templates.ts";

const at = Date.UTC(2026, 10, 11, 14, 30);
const DAY = 86_400_000;
const cloud = { name: "night shift", plan: "shared s", machine: "2 vcpu, 4 gb memory, 8 gb disk", region: "falkenstein" };

/** one filled-in copy of every email, for the tests and the previews */
export function samples(cfg: EmailConfig): Array<{ id: string; trigger: string; email: Rendered }> {
  const notice = (kind: CloudNoticeKind, when: number | null, link?: string) => cloudNoticeEmail(cfg, { kind, name: cloud.name, at: when, link });
  return [
    { id: "01-code", trigger: "sign-in or sign-up code (POST /v1/auth/start, app sign-in start)", email: codeEmail(cfg, { code: "48213097" }) },
    { id: "01b-recovery", trigger: "can't sign in (auth start with recover: true)", email: recoveryEmail(cfg, { code: "48213097", link: `${cfg.app}/sign-in#attempt=x&code=48213097`, ways: ["email", "google"] }) },
    { id: "01c-recovery-none", trigger: "can't sign in, no account uses the address", email: recoveryEmail(cfg, { code: "48213097", ways: null }) },
    { id: "02-welcome", trigger: "first sign-up (auth.onAccountCreated)", email: welcomeEmail(cfg, { cloudFromCents: 2000 }) },
    { id: "03-cloud-ready", trigger: "a cloud's first time running (clouds service save)", email: cloudReadyEmail(cfg, cloud) },
    { id: "04-receipt", trigger: "a paid invoice (billing webhook payment.succeeded)", email: receiptEmail(cfg, { amountCents: 2000, currency: "USD", description: "Shared S", paidAt: at,
      receiptId: "inv_7Qm2xK9", periodStart: at, periodEnd: at + 30 * DAY, renews: true, first: true, cloud: true }) },
    { id: "05-payment-failed", trigger: "subscription on_hold or failed (billing webhook)", email: paymentFailedEmail(cfg, { amountCents: 2000, currency: "USD", description: "Shared S", cloudName: cloud.name, fixBy: at + 7 * DAY }) },
    { id: "06-cancelled", trigger: "plan set to end at period end (cancel route or webhook)", email: cancelledEmail(cfg, { description: "Shared S", cloudName: cloud.name, endsAt: at + 20 * DAY, keepDays: 45, keptPaused: true }) },
    { id: "07-cloud-deleted", trigger: "cloud deleted (managed notice deleted, or generic lifecycle)", email: cloudDeletedEmail(cfg, { name: cloud.name, at }) },
    { id: "08-account-deleted", trigger: "account deleted (auth.onAccountDeleted)", email: accountDeletedEmail(cfg, { email: "sam@example.com" }) },
    { id: "09-new-device", trigger: "template only: no new-place tracking yet", email: newDeviceEmail(cfg, { device: "sam's macbook", platform: "macos", at, where: null }) },
    { id: "10-promo", trigger: "template only: launches and feature news", email: promoEmail(cfg, {
      subject: "rooms are here", preheader: "put a few bots in one chat and let them pass work along.", eyebrow: "new", title: "bots can work together now",
      intro: "rooms are group chats for your bots. give each one a job, drop them in a room, and they hand work to each other while you watch, or don't.",
      features: [{ title: "hand-offs", text: "the researcher finds it, the writer drafts it, the reviewer checks it. one message from you." },
        { title: "jump in any time", text: "type in the room like any group chat. every bot reads along." }],
      cta: { label: "open the app", href: `${cfg.site}/download` }, unsubscribe: "https://dusk.bot/unsubscribe?t=sample" }) },
    { id: "11-notice-ended", trigger: "managed notice: ended", email: notice("ended", at + 45 * DAY) },
    { id: "11-notice-left-7", trigger: "managed notice: left_30, left_7, left_1", email: notice("left_7", at + 7 * DAY) },
    { id: "11-notice-delete-requested", trigger: "managed notice: delete_requested", email: notice("delete_requested", null, `${cfg.app}/clouds/c1/delete#token`) },
    { id: "11-notice-delete-scheduled", trigger: "managed notice: delete_scheduled", email: notice("delete_scheduled", at + 7 * DAY) },
    { id: "11-notice-delete-cancelled", trigger: "managed notice: delete_cancelled", email: notice("delete_cancelled", null) },
    { id: "11-notice-recovered", trigger: "managed notice: recovered", email: notice("recovered", at - DAY) },
    { id: "11-notice-resumed", trigger: "managed notice: resumed", email: notice("resumed", null) },
  ];
}
