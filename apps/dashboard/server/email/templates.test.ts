import { describe, expect, it } from "vitest";
import { samples } from "./samples.ts";
import { EMAIL_ASSETS, emailConfig, promoEmail } from "./templates.ts";

const cfg = emailConfig({}, { publicUrl: "https://preview.dusk.bot", pageBase: "/app" });
const all = samples(cfg);
const hrefs = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map(match => match[1]!.replace(/&amp;/g, "&"));
const BILLING = new Set(["04-receipt", "05-payment-failed"]);

describe("account emails", () => {
  it.each(all.map(sample => [sample.id, sample.email] as const))("%s renders whole, in html and text", (_id, email) => {
    expect(email.subject.length).toBeGreaterThan(3);
    for (const part of [email.subject, email.html, email.text]) {
      expect(part).not.toMatch(/undefined|\bnull\b|NaN|\[object |\$\{|\*\*|—/);
    }
    expect(email.text).not.toMatch(/<[a-z/]/i);
    expect(email.html).toMatch(/^<!doctype html>/);
    expect(email.html).toContain('<meta name="color-scheme" content="light dark">');
    expect(email.html).toContain(`${cfg.assets}/kit-64.png`);
    expect(email.html).toContain(">dusk bot<");
    for (const href of hrefs(email.html)) expect(href).toMatch(/^https:\/\/[a-z0-9.-]+\//);
    for (const tag of email.html.match(/<img [^>]*>/g) ?? []) {
      expect(tag).toMatch(/ alt="[^"]*"/);
      const src = /src="([^"]+)"/.exec(tag)![1]!;
      expect(src.startsWith(`${cfg.assets}/`)).toBe(true);
      expect(EMAIL_ASSETS).toContain(src.slice(cfg.assets.length + 1));
    }
    // every link in the html is also spelled out in the text
    for (const href of hrefs(email.html)) expect(email.text).toContain(href);
  });

  it("keeps billing links low-key: one plain footer link, never a button, and the cancel email has none", () => {
    for (const { id, email } of all) {
      const buttons = [...email.html.matchAll(/class="btn-a" href="([^"]*)"/g)].map(match => match[1]!);
      for (const href of buttons) expect(href).not.toMatch(/\/billing/);
      const plan = hrefs(email.html).filter(href => href.endsWith("/app/billing"));
      expect(plan).toHaveLength(BILLING.has(id) ? 1 : 0);
      if (BILLING.has(id)) expect(email.html).toMatch(/>your plan<\/a>/);
      expect(email.html).not.toMatch(/>(manage billing|cancel[^<]*)<\/a>/i);
    }
  });

  it("keeps what a receipt must say in plain sight", () => {
    const receipt = all.find(sample => sample.id === "04-receipt")!.email;
    for (const fact of ["$20.00", "Shared S", "next charge", "december 11, 2026", "inv_7Qm2xK9"]) { expect(receipt.text).toContain(fact); expect(receipt.html).toContain(fact); }
  });

  it("puts the code in the subject, body and text, and escapes data", () => {
    const code = all.find(sample => sample.id === "01-code")!.email;
    expect(code.subject).toBe("48213097 is your dusk bot code");
    expect(code.text).toContain("    48213097");
    const welcome = all.find(sample => sample.id === "02-welcome")!.email;
    expect(welcome.text).toContain("from $20/mo");
    expect(welcome.html).toContain("https://preview.dusk.bot/app/cloud");
    const deleted = samples(cfg).find(sample => sample.id === "08-account-deleted")!;
    expect(deleted.email.html).not.toContain("<script");
  });

  it("refuses a promo without an unsubscribe link", () => {
    expect(() => promoEmail(cfg, { subject: "x", preheader: "x", eyebrow: "new", title: "x", intro: "x", features: [], cta: { label: "x", href: "https://dusk.bot/" }, unsubscribe: "" })).toThrow();
  });

  it("reads its asset base and site from the environment", () => {
    expect(emailConfig({ DUSK_EMAIL_ASSET_BASE: "https://cdn.example.test/e/" }, { publicUrl: "https://app.example.test" })).toMatchObject({ assets: "https://cdn.example.test/e", site: "https://dusk.bot", app: "https://app.example.test" });
    expect(emailConfig({}, { publicUrl: "https://preview.dusk.bot/x", pageBase: "/app" })).toMatchObject({ assets: "https://dusk.bot/email", site: "https://preview.dusk.bot", app: "https://preview.dusk.bot/app" });
  });
});
