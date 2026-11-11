import { render } from "./layout.ts";
import type { Block, EmailConfig, Rendered } from "./layout.ts";

export type { EmailConfig, Rendered } from "./layout.ts";

const DAY = 86_400_000;
const ACCOUNT_REASON = "you got this because you have a dusk bot account. it's about your account, so it can't be turned off.";

export function emailConfig(env: NodeJS.ProcessEnv, { publicUrl, pageBase = "" }: { publicUrl: string; pageBase?: string }): EmailConfig {
  const origin = new URL(publicUrl).origin, trim = (value: string) => value.replace(/\/+$/, "");
  return {
    assets: trim(env.DUSK_EMAIL_ASSET_BASE || "https://dusk.bot/email"),
    site: trim(env.DUSK_EMAIL_SITE_URL || (pageBase ? origin : "https://dusk.bot")),
    app: `${origin}${pageBase}`,
    x: "https://x.com/duskbot_hq",
    address: env.DUSK_MAIL_POSTAL_ADDRESS?.trim() || null,
  };
}

export function formatDate(at: number) {
  return new Date(at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).toLowerCase();
}
export function formatMoney(cents: number, currency = "USD") {
  const amount = new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);
  return currency.toUpperCase() === "USD" ? amount : `${amount} ${currency.toUpperCase()}`;
}
const joinOr = (items: string[]) => items.length > 1 ? `${items.slice(0, -1).join(", ")} or ${items.at(-1)}` : items[0] ?? "";

/** every image the emails use, relative to the asset base; the site build must ship each one */
export const EMAIL_ASSETS = ["kit-64.png", "hero-code.png", "hero-welcome.png", "hero-cloud-ready.png", "hero-receipt.png", "hero-payment.png", "hero-cancelled.png",
  "hero-cloud-deleted.png", "hero-account-deleted.png", "hero-device.png", "hero-heads-up.png", "hero-promo.png", "cloud-night.png", "tip-jobs.png", "tip-routines.png", "tip-rooms.png"];

const HERO = {
  code: { image: "hero-code.png", alt: "kit the pixel cat on a hill, saying: psst, your code.", height: 120 },
  welcome: { image: "hero-welcome.png", alt: "a crowd of pixel bots on a sunny meadow. kit says: hi! meet your new team.", height: 180 },
  ready: { image: "hero-cloud-ready.png", alt: "pip sits on a pixel cloud and says: your cloud is up.", height: 180 },
  receipt: { image: "hero-receipt.png", alt: "a pixel ticket stamped paid, with loaf beside it.", height: 180 },
  payment: { image: "hero-payment.png", alt: "a small rain cloud over pip. pip says: card trouble.", height: 180 },
  cancelled: { image: "hero-cancelled.png", alt: "a sunset meadow. mochi waves and says: see you soon.", height: 180 },
  cloudGone: { image: "hero-cloud-deleted.png", alt: "a night sky with an empty dotted cloud. wisp says: all cleared.", height: 180 },
  bye: { image: "hero-account-deleted.png", alt: "the sun sets behind a hill as kit walks away. kit says: bye for now.", height: 180 },
  device: { image: "hero-device.png", alt: "hoot the pixel owl on a hill, asking: was this you?", height: 180 },
  headsUp: { image: "hero-heads-up.png", alt: "a dusk sky. cheep holds a small lemon flag: heads up.", height: 180 },
  promo: { image: "hero-promo.png", alt: "pixel bots on clouds over a lime meadow.", height: 180 },
};

/** the sign-in or sign-up code */
export function codeEmail(cfg: EmailConfig, { code }: { code: string }): Rendered {
  return render(cfg, {
    subject: `${code} is your dusk bot code`, preheader: "it works for 10 minutes.", tag: "sign in", hero: HERO.code,
    blocks: [
      { t: "h1", text: "here's your code" },
      { t: "p", text: "type it where you signed in. it works for 10 minutes." },
      { t: "code", code },
      { t: "p", small: true, text: "didn't ask for this? you can ignore it. nobody gets in without the code." },
    ],
    reason: "you got this because someone typed this address into dusk bot.",
  });
}

const WAYS: Record<string, string> = { email: "an emailed code", google: "google", apple: "apple", x: "x" };
/** "can't sign in?": the code, a one-time link for the website, and the ways this address signs in. `ways` null: no
 *  account uses the address, so no code goes out */
export function recoveryEmail(cfg: EmailConfig, { code, link = null, ways }: { code: string; link?: string | null; ways: string[] | null }): Rendered {
  const reason = "you got this because someone asked to sign in to dusk bot with this address.";
  if (!ways) return render(cfg, {
    subject: "signing in to dusk bot", preheader: "no dusk bot account uses this address.", tag: "sign in", hero: HERO.code,
    blocks: [
      { t: "h1", text: "no account uses this address" },
      { t: "p", text: "someone asked to sign in to dusk bot with this address, but no account uses it. try another address you use." },
      { t: "p", small: true, text: "didn't ask? you can ignore this email." },
    ], reason,
  });
  const list = joinOr(ways.map(way => WAYS[way] ?? way)) || WAYS.email;
  return render(cfg, {
    subject: "sign in to dusk bot", preheader: `your code, and the ways this account signs in.`, tag: "sign in", hero: HERO.code,
    blocks: [
      { t: "h1", text: "here's how you get back in" },
      { t: "p", text: "use this code where you asked. it works for 10 minutes." },
      { t: "code", code },
      ...(link ? [{ t: "button", label: "sign in", href: link } as Block] : []),
      { t: "note", text: `this account signs in with **${list}**.` },
      { t: "p", small: true, text: "didn't ask? you can ignore this email. nothing changes." },
    ], reason,
  });
}

/** after the first sign-up */
export function welcomeEmail(cfg: EmailConfig, { cloudFromCents }: { cloudFromCents: number }): Rendered {
  return render(cfg, {
    subject: "welcome to dusk bot", preheader: "a team of ai bots you text like teammates. here's how to get going.", tag: "welcome", hero: HERO.welcome,
    blocks: [
      { t: "h1", text: "welcome to dusk bot" },
      { t: "p", text: "dusk bot is a chat app for a team of ai bots. you text them like teammates, and they get real work done on your computer." },
      { t: "button", label: "get the app", href: `${cfg.site}/download` },
      { t: "cloud", eyebrow: "dusk cloud", title: "keep your bots awake 24/7",
        text: "your laptop sleeps. your bots don't have to. dusk cloud gives them their own always-on computer, so routines run on time and replies land while your lid is shut.",
        points: ["runs when your computer is off", "your desktop and phone reach it from anywhere", "set up and looked after for you, with backups"],
        price: `from ${formatMoney(cloudFromCents).replace(/\.00$/, "")}/mo`, fine: "cancel any time", cta: { label: "get dusk cloud", href: `${cfg.app}/cloud` },
        image: "cloud-night.png", alt: "pixel bots wide awake on a cloud under a starry night sky." },
      { t: "h2", text: "3 pro tips to start" },
      { t: "tips", items: [
        { image: "tip-jobs.png", alt: "two pixel bots, each with its own badge.", title: "give each bot a job", text: "one for your inbox, one for research, one for code. a clear job makes a sharper bot." },
        { image: "tip-routines.png", alt: "a pixel bot beside a small clock.", title: "set up routines", text: "ask a bot to do something on a schedule, like a news brief every morning at 8. it just shows up." },
        { image: "tip-rooms.png", alt: "three pixel bots chatting together.", title: "put bots in a room", text: "add a few bots to one group chat and let them pass work along. jump in whenever you want." },
      ] },
      { t: "p", small: true, text: "stuck on something? reply to this email. a person reads it." },
    ],
    reason: ACCOUNT_REASON,
  });
}

export interface CloudFacts { name: string; plan: string; machine: string | null; region: string | null }
const cloudRows = (cloud: CloudFacts, status: [string, "ok" | "warn" | "off"]): Array<[string, string, ("ok" | "warn" | "off")?]> => [
  ["cloud", cloud.name], ["status", status[0], status[1]], ["plan", cloud.plan],
  ...(cloud.machine ? [["machine", cloud.machine] as [string, string]] : []), ...(cloud.region ? [["region", cloud.region] as [string, string]] : []),
];

/** a cloud's first time up */
export function cloudReadyEmail(cfg: EmailConfig, cloud: CloudFacts): Rendered {
  return render(cfg, {
    subject: `your dusk cloud is ready`, preheader: `${cloud.name} is up and running. pair the app and give it something to do.`, tag: "dusk cloud", hero: HERO.ready,
    blocks: [
      { t: "h1", text: "your dusk cloud is ready" },
      { t: "p", text: `**${cloud.name}** is up and running. from now on your bots can work around the clock, even with your computer off.` },
      { t: "facts", rows: cloudRows(cloud, ["running", "ok"]) },
      { t: "h2", text: "what now" },
      { t: "steps", items: [
        { title: "open the app and sign in", text: "use this email in dusk bot on your computer or phone. it finds your cloud by itself." },
        { title: "move a bot over", text: "pick a bot that should never sleep and move it to your cloud." },
        { title: "give it a first routine", text: "try: **\"every morning at 8, send me the top ai news.\"**" },
      ] },
      { t: "button", label: "open your cloud", href: `${cfg.app}/cloud` },
    ],
    reason: ACCOUNT_REASON,
  });
}

export interface ReceiptInput {
  amountCents: number; currency: string; description: string; paidAt: number; receiptId: string;
  periodStart: number | null; periodEnd: number | null; renews: boolean; first: boolean;
  /** a dusk cloud plan: the button opens the cloud, otherwise the app */
  cloud: boolean;
}
/** a payment that went through: a new plan, a renewal or credits */
export function receiptEmail(cfg: EmailConfig, input: ReceiptInput): Rendered {
  const amount = formatMoney(input.amountCents, input.currency);
  const rows: Array<[string, string]> = [["amount", amount], ["for", input.description], ["paid on", formatDate(input.paidAt)]];
  if (input.periodStart !== null && input.periodEnd !== null) rows.push(["period", `${formatDate(input.periodStart)} to ${formatDate(input.periodEnd)}`]);
  if (input.periodEnd !== null) rows.push(["next charge", input.renews ? formatDate(input.periodEnd) : "none, the plan ends then"]);
  rows.push(["receipt", input.receiptId]);
  return render(cfg, {
    subject: `receipt for ${amount}: ${input.description}`, preheader: `thanks! ${amount} for ${input.description}.`, tag: "receipt", hero: HERO.receipt,
    blocks: [
      { t: "h1", text: input.first ? "thanks, you're all set" : "thanks, payment received" },
      { t: "p", text: input.first ? `your plan is active. here's your receipt for **${input.description}**.` : `here's your receipt for **${input.description}**. nothing else to do.` },
      { t: "facts", rows },
      input.cloud ? { t: "button", label: "open dusk cloud", href: `${cfg.app}/cloud` } : { t: "button", label: "open the app", href: `${cfg.site}/download` },
      { t: "p", small: true, text: "invoices and plan details live on your plan page, linked below." },
    ],
    reason: ACCOUNT_REASON, plan: `${cfg.app}/billing`,
  });
}

export interface PaymentFailedInput { amountCents: number | null; currency: string; description: string; cloudName: string | null; fixBy: number | null }
export function paymentFailedEmail(cfg: EmailConfig, input: PaymentFailedInput): Rendered {
  const amount = input.amountCents === null ? null : formatMoney(input.amountCents, input.currency);
  return render(cfg, {
    subject: "your payment didn't go through", preheader: `update your card to keep ${input.cloudName ?? "your plan"} running.`, tag: "billing", hero: HERO.payment,
    blocks: [
      { t: "h1", text: "your card needs a look" },
      { t: "p", text: `we couldn't charge ${amount ? `**${amount}** ` : ""}for **${input.description}**. usually it's an expired card, a new card number or the bank saying no.` },
      ...(input.fixBy !== null ? [{ t: "note", tone: "alert", text: input.cloudName
        ? `**${input.cloudName}** keeps running for now. fix the card by **${formatDate(input.fixBy)}** so it doesn't stop.`
        : `fix the card by **${formatDate(input.fixBy)}** to keep your plan.` } as Block] : []),
      { t: "p", text: "you can update the card from **your plan**, linked at the bottom of this email." },
      input.cloudName ? { t: "button", label: "open dusk cloud", href: `${cfg.app}/cloud` } : { t: "button", label: "open the app", href: `${cfg.site}/download` },
      { t: "p", small: true, text: "already fixed it? then you're good, there's nothing else to do." },
    ],
    reason: ACCOUNT_REASON, plan: `${cfg.app}/billing`,
  });
}

/** `keptPaused`: the cloud pauses at the end and is kept `keepDays` with warnings first (a managed cloud); otherwise it is
 *  removed `keepDays` after the end */
export interface CancelledInput { description: string; cloudName: string | null; endsAt: number | null; keepDays: number; keptPaused: boolean }
export function cancelledEmail(cfg: EmailConfig, input: CancelledInput): Rendered {
  const ends = input.endsAt === null ? null : formatDate(input.endsAt);
  const keepUntil = input.endsAt === null ? null : formatDate(input.endsAt + input.keepDays * DAY);
  const what = input.cloudName ? `**${input.cloudName}**` : "your plan";
  return render(cfg, {
    subject: `your ${input.description} plan is cancelled`, preheader: ends ? `everything keeps working until ${ends}.` : "no more charges.", tag: "billing", hero: HERO.cancelled,
    blocks: [
      { t: "h1", text: ends ? `you keep everything until ${ends}` : "your plan is cancelled" },
      { t: "p", text: ends ? `your plan is cancelled, but nothing changes today. ${what} keeps working until **${ends}**, the end of what you paid for, and there are no more charges after that.` : "no more charges. thanks for giving it a go." },
      ...(input.cloudName && input.keptPaused ? [{ t: "p", text: `after that, ${input.cloudName} is paused, not deleted. your bots, chats, files and sign-ins stay put, and we email you before anything is removed.` } as Block] : []),
      { t: "facts", rows: [
        ...(ends ? [["works until", ends, "ok"] as [string, string, "ok"]] : []),
        ...(input.cloudName ? [["data kept", keepUntil ? `${input.keptPaused ? "at least " : ""}until ${keepUntil}` : `${input.keptPaused ? "at least " : ""}${input.keepDays} days`, "warn"] as [string, string, "warn"]] : []),
        ["plan", input.description],
      ] },
      ...(input.cloudName && !input.keptPaused ? [{ t: "note", tone: "warn", text: `after ${keepUntil ?? "that"}, ${input.cloudName} and what's on it are deleted. move anything you want to keep before then.` } as Block] : []),
      { t: "p", text: "whenever you want your bots running around the clock again, it's one step away." },
      { t: "button", label: "come back to dusk cloud", href: `${cfg.app}/cloud` },
    ],
    reason: ACCOUNT_REASON,
  });
}

/** a cloud that was taken down and its data removed */
export function cloudDeletedEmail(cfg: EmailConfig, { name, at }: { name: string; at: number }): Rendered {
  return render(cfg, {
    subject: `${name} was deleted`, preheader: `${name} and its data are gone. your account and the app on your computer are untouched.`, tag: "dusk cloud", hero: HERO.cloudGone,
    blocks: [
      { t: "h1", text: `${name} is deleted` },
      { t: "p", text: `we deleted **${name}** on ${formatDate(at)}. this can't be undone.` },
      { t: "h2", text: "what was removed" },
      { t: "list", items: ["the cloud computer itself", "the bots, chats, files and sign-ins that lived on it", "its backups, cleared out soon after if any are left"] },
      { t: "note", tone: "info", text: "**what stays:** your dusk bot account, and the app and bots on your own computer." },
      { t: "button", label: "start a new cloud", href: `${cfg.app}/cloud` },
    ],
    reason: ACCOUNT_REASON,
  });
}

export function accountDeletedEmail(cfg: EmailConfig, { email }: { email: string }): Rendered {
  return render(cfg, {
    subject: "your dusk bot account is deleted", preheader: `everything tied to ${email} is gone.`, tag: "account", hero: HERO.bye,
    blocks: [
      { t: "h1", text: "your account is deleted" },
      { t: "p", text: `thanks for trying dusk bot. the account for **${email}** is gone, and here's what went with it:` },
      { t: "list", items: ["your account, sign-ins and sessions", "your plans, so no more charges", "your clouds and everything on them"] },
      { t: "note", tone: "info", text: "**what stays:** the dusk bot app and your bots on your own computer are yours. uninstall the app to remove them. payment records we have to keep by law stay, without your details." },
      { t: "p", text: "if you ever want back in, signing up again takes a minute." },
      { t: "p", small: true, text: "didn't delete your account? reply to this email right away." },
    ],
    reason: "you got this because your dusk bot account was just deleted. this is the last email we send to this address.",
  });
}

export interface DeviceInput { device: string; platform: string; at: number; where: string | null }
/** template only: the service does not notice new places yet. the hook would be the app grant in auth/index.ts */
export function newDeviceEmail(cfg: EmailConfig, input: DeviceInput): Rendered {
  return render(cfg, {
    subject: "new sign-in to dusk bot", preheader: `${input.device} just signed in to your account.`, tag: "security", hero: HERO.device,
    blocks: [
      { t: "h1", text: "was this you?" },
      { t: "p", text: "your account just signed in on a device we haven't seen before." },
      { t: "facts", rows: [["device", input.device], ["system", input.platform], ["when", `${formatDate(input.at)}, ${new Date(input.at).toISOString().slice(11, 16)} utc`], ...(input.where ? [["where", input.where] as [string, string]] : [])] },
      { t: "p", text: "if it was you, there's nothing to do. if not, sign that device out and check how your account signs in." },
      { t: "button", label: "review your devices", href: `${cfg.app}/devices` },
    ],
    reason: ACCOUNT_REASON,
  });
}

export interface PromoInput {
  subject: string; preheader: string; eyebrow: string; title: string; intro: string;
  hero?: { image: string; alt: string; height: number };
  features: Array<{ image?: string; alt?: string; title: string; text: string }>;
  cta: { label: string; href: string }; unsubscribe: string;
}
/** a launch or feature announcement; marketing, so it always carries an unsubscribe link */
export function promoEmail(cfg: EmailConfig, input: PromoInput): Rendered {
  if (!input.unsubscribe.startsWith("https://")) throw new Error("A promo email needs an https unsubscribe link.");
  return render(cfg, {
    subject: input.subject, preheader: input.preheader, tag: input.eyebrow, hero: input.hero ?? HERO.promo,
    blocks: [
      { t: "h1", text: input.title },
      { t: "p", text: input.intro },
      { t: "button", label: input.cta.label, href: input.cta.href },
      ...input.features.map(feature => ({ t: "feature", image: feature.image ?? null, alt: feature.alt ?? "", title: feature.title, text: feature.text }) as Block),
    ],
    reason: "you got this because you signed up for dusk bot news.", unsubscribe: input.unsubscribe,
  });
}

export type CloudNoticeKind = "ended" | "left_30" | "left_7" | "left_1" | "deleted" | "recovered" | "delete_requested" | "delete_scheduled" | "delete_cancelled" | "resumed";
/** the managed cloud backend's letters (apps/cloud-service retention notices) in the same dress */
export function cloudNoticeEmail(cfg: EmailConfig, { kind, name, at, link }: { kind: CloudNoticeKind; name: string; at: number | null; link?: string }): Rendered {
  const date = at === null ? null : formatDate(at), cloud = `${cfg.app}/cloud`;
  const base = { tag: "dusk cloud", reason: ACCOUNT_REASON };
  const comeBack: Block = { t: "p", small: true, text: "started a new plan after this one ended? reply to this email and we bring this data over to it." };
  switch (kind) {
    case "ended": return render(cfg, { ...base, subject: `${name} is paused and kept for you`, preheader: date ? `your data is kept until ${date}.` : "your data is kept for now.", hero: HERO.cancelled,
      blocks: [{ t: "h1", text: `${name} is paused` }, { t: "p", text: `the plan for **${name}** ended, so it's paused. nothing is deleted yet.` },
        { t: "facts", rows: [["status", "paused", "off"], ...(date ? [["kept until", date, "warn"] as [string, string, "warn"]] : [])] },
        { t: "p", text: "your bots, chats, files and sign-ins are all still there. start the plan again and it carries on where it stopped." },
        { t: "button", label: "come back to dusk cloud", href: cloud }, comeBack] });
    case "left_30": case "left_7": case "left_1": {
      const days = Number(kind.slice(5));
      return render(cfg, { ...base, subject: `${name} will be deleted in ${days} day${days === 1 ? "" : "s"}`, preheader: date ? `on ${date}, unless the plan starts again.` : "unless the plan starts again.", hero: HERO.headsUp,
        blocks: [{ t: "h1", text: `${days} day${days === 1 ? "" : "s"} left for ${name}` }, { t: "p", text: `**${name}** has been paused since its plan ended.` },
          { t: "note", tone: days === 1 ? "alert" : "warn", text: `${date ? `on **${date}**` : "soon"}, ${name} and everything on it will be deleted for good.` },
          { t: "p", text: "start a plan for it again and it carries on where it stopped." },
          { t: "button", label: "keep my cloud", href: cloud }, comeBack] });
    }
    case "deleted": return cloudDeletedEmail(cfg, { name, at: at ?? Date.now() });
    case "recovered": return render(cfg, { ...base, subject: at === null ? `${name} was set up again` : `${name} was restored from a backup`, preheader: "your app reconnects by itself.", hero: HERO.ready,
      blocks: [{ t: "h1", text: at === null ? `${name} was set up again` : `${name} is back from a backup` },
        { t: "p", text: at === null ? `${name}'s computer stopped working before its first backup, so we set it up again, empty. bots you moved there can be moved again from your computer.`
          : `${name}'s computer stopped working, so we set it up again from its latest backup, taken ${date}. anything after that backup may be missing.` },
        { t: "p", text: "your app reconnects by itself." }, { t: "button", label: "open your cloud", href: cloud }] });
    case "delete_requested": return render(cfg, { ...base, tag: "security", subject: `confirm deleting ${name}`, preheader: "nothing happens unless you confirm within an hour.", hero: HERO.headsUp,
      blocks: [{ t: "h1", text: `delete ${name}?` }, { t: "p", text: `someone signed in to your account asked to delete **${name}** and all of its data. nothing happens unless you confirm within an hour. you may be asked to sign in again.` },
        { t: "button", label: "confirm deletion", href: link ?? cloud },
        { t: "note", tone: "info", text: "after you confirm, it's deleted 7 days later, and you can cancel any time before then." },
        { t: "p", small: true, text: "wasn't you? ignore this email and sign out your other sessions." }] });
    case "delete_scheduled": return render(cfg, { ...base, subject: `${name} will be deleted on ${date ?? "schedule"}`, preheader: "you can still cancel until then.", hero: HERO.headsUp,
      blocks: [{ t: "h1", text: `${name} is set to be deleted` }, { t: "p", text: `you confirmed deleting **${name}**. it and its data, backups included, will be deleted${date ? ` on **${date}**` : ""}.` },
        { t: "note", tone: "warn", text: "changed your mind? until then, your cloud's page can stop the deletion and keep everything." }, { t: "button", label: "open your cloud", href: cloud }] });
    case "delete_cancelled": return render(cfg, { ...base, subject: `${name} will not be deleted`, preheader: "nothing was deleted.", hero: HERO.ready,
      blocks: [{ t: "h1", text: `${name} stays` }, { t: "p", text: `the request to delete **${name}** was cancelled. nothing was deleted.` }, { t: "button", label: "open your cloud", href: cloud }] });
    case "resumed": return render(cfg, { ...base, subject: `${name} is back`, preheader: "it carries on where it stopped.", hero: HERO.ready,
      blocks: [{ t: "h1", text: `${name} is back` }, { t: "p", text: `the plan for **${name}** is active again, and it carries on where it stopped.` }, { t: "button", label: "open your cloud", href: cloud }] });
  }
}
