import type { ReactNode } from "react";
import { CreditCard, House, Server, Sparkles, Users } from "@/icons";

/** one view inside a section: its own address, an optional g-key, and the paths that also light it */
export interface Tab { to: string; label: string; key?: string; also?: RegExp }
export interface Section { id: string; label: string; key: string; icon: ReactNode; tabs: Tab[] }

const ICON = { size: 17, strokeWidth: 1.75 } as const;
/** five places, each with its views; the first view of each is where the section opens */
export const SECTIONS: Section[] = [
  { id: "home", label: "home", key: "h", icon: <House {...ICON} />, tabs: [{ to: "/admin", label: "home", key: "o" }] },
  { id: "people", label: "people", key: "p", icon: <Users {...ICON} />, tabs: [
    { to: "/admin/people", label: "accounts", also: /^\/admin\/users(\/|$)/ },
    { to: "/admin/people/visitors", label: "visitors", key: "v" },
    { to: "/admin/traffic", label: "traffic", key: "t", also: /^\/admin\/analytics\// },
    { to: "/admin/waitlist", label: "waitlist", key: "w" },
  ] },
  { id: "payments", label: "payments", key: "m", icon: <CreditCard {...ICON} />, tabs: [
    { to: "/admin/payments", label: "payments" },
    { to: "/admin/revenue", label: "revenue analysis", key: "n" },
  ] },
  { id: "product", label: "product", key: "i", icon: <Sparkles {...ICON} />, tabs: [
    { to: "/admin/experience", label: "experience", key: "b" },
    { to: "/admin/bug-reports", label: "bug reports", key: "d" },
    { to: "/admin/feedback", label: "feedback", key: "f" },
    { to: "/admin/retention", label: "retention", key: "r" },
    { to: "/admin/product", label: "usage", key: "y", also: /^\/admin\/product\// },
  ] },
  { id: "ops", label: "operations", key: "x", icon: <Server {...ICON} />, tabs: [
    { to: "/admin/clouds", label: "clouds", key: "c" },
    { to: "/admin/ops", label: "servers" },
    { to: "/admin/ops/accounts", label: "accounts usage", key: "u" },
    { to: "/admin/live", label: "live", key: "l" },
    { to: "/admin/health", label: "health", key: "e" },
    { to: "/admin/events", label: "events" },
    { to: "/admin/audit", label: "audit log", key: "a" },
  ] },
];

/** old addresses that moved; they redirect, keeping the query */
export const MOVED: Record<string, string> = {
  "/admin/funnel": "/admin", "/admin/users": "/admin/people", "/admin/people/waitlist": "/admin/waitlist", "/admin/app": "/admin/product/apps",
  "/admin/product/retention": "/admin/retention", "/admin/analytics": "/admin/traffic",
};

/** the view a path belongs to, and its section; exact first, then a pattern, then the longest prefix */
export function currentItem(path: string): (Tab & { section: Section }) | null {
  let best: (Tab & { section: Section }) | null = null, length = -1;
  for (const section of SECTIONS) for (const tab of section.tabs) {
    if (tab.to === path) return { ...tab, section };
    const hit = tab.also?.test(path) ? 1000 : tab.to !== "/admin" && path.startsWith(`${tab.to}/`) ? tab.to.length : -1;
    if (hit > length) { best = { ...tab, section }; length = hit; }
  }
  return best;
}

/** every g-key: sections first, then their views */
export const KEYS: Array<{ key: string; to: string; label: string }> = [
  ...SECTIONS.map((s) => ({ key: s.key, to: s.tabs[0]!.to, label: s.label })),
  ...SECTIONS.flatMap((s) => s.tabs.filter((t) => t.key).map((t) => ({ key: t.key!, to: t.to, label: `${s.label}: ${t.label}` }))),
];
