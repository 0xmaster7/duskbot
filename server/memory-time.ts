// Dates in facts and time words in questions, so "where did I live last spring" finds what held then.
export interface DayRange {
  start: string;
  end: string;
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MONTH_WORD = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const SEASONS: Record<string, [number, number]> = { spring: [3, 5], summer: [6, 8], autumn: [9, 11], fall: [9, 11], winter: [12, 14] };

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

function monthIndex(word: string): number {
  const w = word.toLowerCase().slice(0, 3);
  return MONTHS.findIndex((m) => m.startsWith(w)) + 1;
}

/** Month `m` may run past 12: month 14 of 2026 is February 2027. */
function monthRange(y: number, from: number, to: number): DayRange {
  const endYear = y + Math.floor((to - 1) / 12);
  const endMonth = ((to - 1) % 12) + 1;
  return { start: ymd(y, from, 1), end: ymd(endYear, endMonth, daysIn(endYear, endMonth)) };
}

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function parts(day: string): { y: number; m: number; d: number } {
  return { y: Number(day.slice(0, 4)), m: Number(day.slice(5, 7)), d: Number(day.slice(8, 10)) };
}

/** The span of days a fact's own words name ("in April 2026", "on 2026-03-14", "spring 2025"); null when it names none. */
export function factDates(text: string): DayRange | null {
  const found: DayRange[] = [];
  for (const m of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) found.push({ start: m[0], end: m[0] });
  for (const m of text.matchAll(new RegExp(`\\b${MONTH_WORD}\\.? (\\d{1,2})(?:st|nd|rd|th)?,? (\\d{4})\\b`, "gi"))) {
    const day = ymd(Number(m[3]), monthIndex(m[1]!), Number(m[2]));
    found.push({ start: day, end: day });
  }
  for (const m of text.matchAll(new RegExp(`\\b(\\d{1,2}) ${MONTH_WORD}\\.?,? (\\d{4})\\b`, "gi"))) {
    const day = ymd(Number(m[3]), monthIndex(m[2]!), Number(m[1]));
    found.push({ start: day, end: day });
  }
  if (!found.length) {
    for (const m of text.matchAll(new RegExp(`\\b${MONTH_WORD}\\.? (?:of )?(\\d{4})\\b`, "gi"))) {
      const month = monthIndex(m[1]!);
      found.push(monthRange(Number(m[2]), month, month));
    }
  }
  if (!found.length) {
    for (const m of text.matchAll(/\b(spring|summer|autumn|fall|winter)(?: of)? (\d{4})\b/gi)) {
      const [from, to] = SEASONS[m[1]!.toLowerCase()]!;
      found.push(monthRange(Number(m[2]), from, to));
    }
  }
  if (!found.length) {
    for (const m of text.matchAll(/\b(?:in|since|during|of|from|until|by) ((?:19|20)\d{2})\b/gi)) found.push({ start: `${m[1]}-01-01`, end: `${m[1]}-12-31` });
  }
  if (!found.length) return null;
  const valid = found.filter((r) => !Number.isNaN(Date.parse(r.start)) && !Number.isNaN(Date.parse(r.end)));
  if (!valid.length) return null;
  return { start: valid.map((r) => r.start).sort()[0]!, end: valid.map((r) => r.end).sort().at(-1)! };
}

/** The most recent completed or current `season` as of `today` ("last spring" in November is this year's spring). */
function seasonRange(season: string, today: string, last: boolean): DayRange {
  const { y, m } = parts(today);
  const [from, to] = SEASONS[season]!;
  const winter = from === 12;
  // a winter that started last December is still "this winter" in January and February
  let year = winter && m <= 2 ? y - 1 : y;
  const range = () => monthRange(year, from, to);
  if (range().start > today) year -= 1;
  else if (last && range().end >= today) year -= 1;
  return range();
}

export interface QueryTime {
  range: DayRange | null;
  /** The question is about how things were, not how they are: replaced facts may answer it. */
  past: boolean;
}

const PAST_WORDS = /\b(?:used to|before|previous(?:ly)?|formerly|back then|at the time|earlier|ago|history|changed|originally|first|old|past|was|were|did|had)\b/i;

/** The window of days a question asks about, resolved against `today`, and whether it asks about the past. */
export function queryTime(query: string, today: string): QueryTime {
  const q = query.toLowerCase();
  const { y, m } = parts(today);
  let range: DayRange | null = null;
  let match: RegExpExecArray | null;
  if (/\byesterday\b/.test(q)) range = { start: addDays(today, -1), end: addDays(today, -1) };
  else if (/\blast week\b/.test(q)) range = { start: addDays(today, -13), end: addDays(today, -7) };
  else if (/\bthis week\b/.test(q)) range = { start: addDays(today, -6), end: today };
  else if (/\blast month\b/.test(q)) range = m === 1 ? monthRange(y - 1, 12, 12) : monthRange(y, m - 1, m - 1);
  else if (/\bthis month\b/.test(q)) range = monthRange(y, m, m);
  else if (/\blast year\b/.test(q)) range = { start: `${y - 1}-01-01`, end: `${y - 1}-12-31` };
  else if (/\b(?:this year|so far this year|earlier this year)\b/.test(q)) range = { start: `${y}-01-01`, end: today };
  else if ((match = /\b(\d+|a|an|one|two|three|four|five|six)\s+(day|week|month|year)s?\s+ago\b/.exec(q))) {
    const words: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
    const n = words[match[1]!] ?? Number(match[1]);
    const unit = { day: 1, week: 7, month: 30, year: 365 }[match[2] as "day" | "week" | "month" | "year"];
    const center = addDays(today, -n * unit);
    const slack = Math.max(1, Math.round((n * unit) / 4));
    range = { start: addDays(center, -slack), end: addDays(center, slack) };
  } else if ((match = /\b(last|this|past)?\s*(spring|summer|autumn|fall|winter)(?:\s+(?:of\s+)?(\d{4}))?\b/.exec(q)) && (match[1] || match[3] || /\b(?:in|during|over) (?:the )?(?:spring|summer|autumn|fall|winter)\b/.test(q))) {
    range = match[3] ? monthRange(Number(match[3]), ...SEASONS[match[2]!]!) : seasonRange(match[2]!, today, match[1] === "last" || match[1] === "past");
  } else if ((match = new RegExp(`\\b(last|this)?\\s*${MONTH_WORD}\\b(?:\\s+(\\d{4}))?`).exec(q)) && (match[1] || match[3] || /\b(?:in|during|since|on|by)\s+/.test(q.slice(Math.max(0, match.index - 7), match.index + 1)))) {
    // "may" alone is the verb far more often than the month
    if (!(match[2] === "may" && !match[1] && !match[3] && !/\b(?:in|during|since) may\b/.test(q))) {
      const month = monthIndex(match[2]!);
      const year = match[3] ? Number(match[3]) : month > m || (match[1] === "last" && month >= m) ? y - 1 : y;
      range = monthRange(year, month, month);
    }
  } else if ((match = /\b(?:in|during|since|of)\s+((?:19|20)\d{2})\b/.exec(q))) {
    range = { start: `${match[1]}-01-01`, end: `${match[1]}-12-31` };
  } else if ((match = /\b(\d{4}-\d{2}-\d{2})\b/.exec(q))) {
    range = { start: match[1]!, end: match[1]! };
  }
  const past = Boolean(range && range.end < today) || PAST_WORDS.test(q);
  return { range, past };
}

export function overlaps(a: DayRange, b: DayRange): boolean {
  return a.start <= b.end && b.start <= a.end;
}

/** Days from `day` to the nearest edge of `range`, 0 inside it. */
export function daysOutside(day: DayRange, range: DayRange): number {
  if (overlaps(day, range)) return 0;
  const gap = day.end < range.start ? Date.parse(range.start) - Date.parse(day.end) : Date.parse(day.start) - Date.parse(range.end);
  return Math.round(gap / 86_400_000);
}
