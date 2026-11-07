import { Bot, CreditCard, Gauge, Home, Server, UserRound, type LucideIcon } from "lucide-react";

export interface NavItem { label: string; to: string; icon?: LucideIcon; words?: string; children?: NavItem[] }

export const NAV: NavItem[] = [
  { label: "Home", to: "/", icon: Home, words: "overview dashboard" },
  { label: "Bots", to: "/bots", icon: Bot, words: "agents routines" },
  { label: "Cloud", to: "/cloud", icon: Server, children: [
    { label: "My Cloud", to: "/cloud", words: "machine server vps health restart" },
    { label: "Bot computers", to: "/cloud/computers", words: "desktops wake sleep" },
  ] },
  { label: "Usage", to: "/usage", icon: Gauge, words: "spend cost receipts tokens history" },
  { label: "Billing", to: "/billing", icon: CreditCard, words: "plan invoices balance payment" },
  { label: "Account", to: "/account/profile", icon: UserRound, children: [
    { label: "Profile", to: "/account/profile", words: "name email timezone" },
    { label: "Security & devices", to: "/account/security", words: "passkeys sessions tokens 2fa" },
    { label: "Connections", to: "/account/connections", words: "apps vault ai accounts" },
    { label: "Notifications", to: "/account/notifications", words: "email push alerts" },
    { label: "Data & privacy", to: "/account/privacy", words: "export delete" },
  ] },
];
