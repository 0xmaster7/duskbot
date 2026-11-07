const usdFmt = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const intFmt = new Intl.NumberFormat("en-US");

export const usd = (value: number) => usdFmt.format(value);
export const usdShort = (value: number) => (value >= 100 ? `$${Math.round(value)}` : usd(value));
export const usdTiny = (value: number) => (value > 0 && value < 0.01 ? "<$0.01" : usd(value));
export const int = (value: number) => intFmt.format(Math.round(value));
export const compact = (value: number) =>
  value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)}M` : value >= 10_000 ? `${Math.round(value / 1000)}k` : value >= 1000 ? `${(value / 1000).toFixed(1)}k` : int(value);
export const hours = (value: number) => `${value.toFixed(1)} h`;
export const pct = (value: number) => `${Math.round(value)}%`;

export const dayKey = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
export const fromDayKey = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y!, m! - 1, d!).getTime();
};

const dateFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const dateLongFmt = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
const timeFmt = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });
const monthFmt = new Intl.DateTimeFormat("en-US", { month: "short" });
const monthYearFmt = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" });

export const date = (t: number) => dateFmt.format(t);
export const dateLong = (t: number) => dateLongFmt.format(t);
export const time = (t: number) => timeFmt.format(t);
export const monthName = (t: number) => monthFmt.format(t);
export const monthYear = (t: number) => monthYearFmt.format(t);
export const dateTime = (t: number) => `${dateFmt.format(t)}, ${timeFmt.format(t)}`;

export function ago(t: number, now: number) {
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 31) return d === 1 ? "yesterday" : `${d} days ago`;
  return date(t);
}

export function until(t: number, now: number) {
  const m = Math.round((t - now) / 60_000);
  if (m < 1) return "now";
  if (m < 60) return `in ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `in ${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? "tomorrow" : `in ${d} days`;
}

export function duration(ms: number) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function greeting(t: number) {
  const h = new Date(t).getHours();
  return h < 5 ? "Good night" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}
