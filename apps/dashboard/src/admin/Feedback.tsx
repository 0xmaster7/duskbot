import { useEffect, useState } from "react";
import { ago } from "../lib/format";
import { Button, cx } from "../ui/kit";
import { adminCall, useAdmin } from "./api";
import { AdminHeader, Failed, Loading, Section, n, stamp } from "./ui";

type Kind = "bad" | "big" | "weekly";
interface Note {
  id: string; kind: Kind; at: number; text: string | null;
  engine?: string; category?: string; tools?: string[]; apps?: string[]; signals?: string[];
  turns?: number; minutes?: number; failed?: number; days?: number;
}
interface Theme { key: string; label: string; count: number; examples: string[]; pain: boolean }
interface FeedbackAnswer { notes: Note[]; next: number | null; counts: Record<Kind, number>; themes: Theme[] }

const KINDS: Array<{ id: Kind | null; label: string }> = [{ id: null, label: "all" }, { id: "bad", label: "bad chats" }, { id: "big", label: "big sessions" }, { id: "weekly", label: "weekly" }];
const KIND_TAG: Record<Kind, { label: string; wash: string }> = {
  bad: { label: "bad chat", wash: "bg-wash-pink" }, big: { label: "big session", wash: "bg-wash-lilac" }, weekly: { label: "weekly", wash: "bg-pop/70" },
};
const SIGNAL: Record<string, string> = { thumbs_down: "thumbs down", stopped: "stopped it", retried: "asked again", failed: "turns failed", corrective: "corrected it", shouting: "caps", swearing: "swore" };

/** what a note came with besides its words: the session's size, what it touched, what the person did */
function facts(note: Note): string {
  const parts: string[] = [];
  if (note.kind === "big") parts.push(`${n(note.turns)} turns over ${n(note.minutes)} min${note.failed ? `, ${n(note.failed)} failed` : ""}`);
  if (note.kind === "weekly") parts.push(`${n(note.turns)} turns over ${n(note.days)} days`);
  if (note.signals?.length) parts.push(note.signals.map((signal) => SIGNAL[signal] ?? signal.replace(/_/g, " ")).join(", "));
  const touched = [...(note.apps ?? []).map((app) => app.replace(/_/g, " ")), ...(note.tools ?? []).filter((tool) => tool !== "app")];
  if (note.category) parts.push(note.category);
  if (touched.length) parts.push(touched.join(", "));
  if (note.engine) parts.push(note.engine);
  return parts.join(" · ");
}

/** every note people's own engines wrote about how a session went: after a bad chat, after a big session, and weekly.
 * anonymous: scrubbed on their computer and again on the way in, never tied to an account here. */
export function FeedbackPage() {
  const [kind, setKind] = useState<Kind | null>(null);
  const { data, error, loading, reload } = useAdmin<FeedbackAnswer>(`/feedback${kind ? `?kind=${kind}` : ""}`);
  const [more, setMore] = useState<{ notes: Note[]; next: number | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  useEffect(() => { setMore(null); setMoreError(null); }, [data]);
  const notes = [...(data?.notes ?? []), ...(more?.notes ?? [])];
  const next = more ? more.next : data?.next ?? null;
  const loadMore = async () => {
    if (next === null) return;
    setBusy(true); setMoreError(null);
    try {
      const page = await adminCall<FeedbackAnswer>(`/feedback?before=${next}${kind ? `&kind=${kind}` : ""}`);
      setMore((before) => ({ notes: [...(before?.notes ?? []), ...page.notes], next: page.next }));
    } catch (err) { setMoreError((err as Error).message); } finally { setBusy(false); }
  };
  const friction = data?.themes.filter((theme) => theme.pain) ?? [];
  const rest = data?.themes.filter((theme) => !theme.pain) ?? [];
  const total = data ? data.counts.bad + data.counts.big + data.counts.weekly : 0;
  // each top card quotes a note no card before it quoted
  const quoted = new Set<string>();
  const top = friction.slice(0, 3).map((theme) => {
    const example = theme.examples.find((text) => !quoted.has(text)) ?? null;
    if (example) quoted.add(example);
    return { theme, example };
  });

  return (
    <>
      <AdminHeader title="feedback" sub="how sessions went, in a few anonymous words written on each person's own computer. no messages, names or files." />
      <div role="group" aria-label="which notes" className="mb-8 flex flex-wrap gap-1.5 max-sm:mb-6">
        {KINDS.map((option) => {
          const count = !data ? null : option.id ? data.counts[option.id] : total;
          return (
            <button key={option.label} type="button" aria-pressed={kind === option.id} onClick={() => setKind(option.id)}
              className={cx("inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-14 hover-chip", kind === option.id ? "bg-ink text-bg" : "bg-card text-ink-2")}>
              {option.label}
              {count !== null && <span className={cx("font-mono text-12 num", kind === option.id ? "text-bg/70" : "text-ink-3")}>{n(count)}</span>}
            </button>
          );
        })}
      </div>
      {error && <Failed error={error} retry={reload} />}
      {!data && loading && <Loading />}
      {data && (
        <>
          <Section title="top friction, last 30 days">
            {friction.length ? (
              <ol className="grid grid-cols-3 gap-2 max-lg:grid-cols-1">
                {top.map(({ theme, example }) => (
                  <li key={theme.key} className="rounded-[18px] bg-wash-pink px-4 py-3">
                    <div className="flex items-baseline gap-2"><span className="min-w-0 flex-1 text-14 text-ink">{theme.label}</span><span className="font-mono text-13 text-ink-2 num">{n(theme.count)}</span></div>
                    {example && <p className="mt-1.5 line-clamp-3 text-13 leading-[19px] text-ink-2">"{example}"</p>}
                  </li>
                ))}
              </ol>
            ) : <p className="rounded-[18px] bg-card px-4 py-3 text-13 text-ink-2">no friction mentioned yet.</p>}
            {(friction.length > 3 || rest.length > 0) && (
              <ul aria-label="other themes" className="mt-3 flex flex-wrap gap-1.5">
                {[...friction.slice(3), ...rest].map((theme) => (
                  <li key={theme.key} className={cx("inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-13 text-ink", theme.pain ? "bg-wash-pink" : "bg-card")}>
                    {theme.label}<span className="font-mono text-12 text-ink-3 num">{n(theme.count)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="newest first">
            {notes.length ? (
              <ol className="flex flex-col gap-2">
                {notes.map((note) => (
                  <li key={`${note.kind}:${note.id}`} className="rounded-[18px] bg-card px-4 py-3.5">
                    <div className="flex flex-wrap items-center gap-2 text-12 text-ink-3">
                      <span className={cx("inline-flex h-6 items-center rounded-full px-2.5 text-12 text-ink", KIND_TAG[note.kind].wash)}>{KIND_TAG[note.kind].label}</span>
                      <time dateTime={new Date(note.at).toISOString()} title={stamp(note.at)}>{ago(note.at)}</time>
                    </div>
                    {note.text ? <p className="mt-2 max-w-[72ch] text-14 leading-[22px] text-ink">{note.text}</p>
                      : <p className="mt-2 text-14 leading-[22px] text-ink-3">counts only, no note came with this one.</p>}
                    {facts(note) && <p className="mt-1.5 text-12 text-ink-3">{facts(note)}</p>}
                  </li>
                ))}
              </ol>
            ) : <p className="rounded-[18px] bg-card px-4 py-6 text-center text-13 text-ink-2">nothing here yet. notes come in after a bad chat, after a big session, and once a week from people who use it often.</p>}
            {next !== null && <div className="mt-4 flex justify-center"><Button size="sm" disabled={busy} onClick={() => void loadMore()}>{busy ? "loading…" : "older notes"}</Button></div>}
            {moreError && <p role="alert" className="mt-2 text-center text-13 text-bad">{moreError}</p>}
          </Section>
        </>
      )}
    </>
  );
}
