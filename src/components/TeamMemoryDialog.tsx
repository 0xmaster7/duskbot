import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Loader2, Pin, Plus, Trash2, X } from "lucide-react";


import { api } from "@/state/store";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { cn } from "@/lib/cn";
import { Select } from "./Select";
import { footnoteCls, formBodyCls, formCloseCls, formHeaderCls, formSheetCls, formTitleCls, listCardCls, mdPrimaryCls, mdSecondaryCls, rowHintCls, smallButtonCls, textFieldCls } from "./ui/GrokDialog";

type Kind = "person" | "place" | "decision" | "term";

interface Entry {
  id: string;
  kind: Kind;
  name: string;
  detail: string;
  aliases: string[];
  status: "accepted" | "proposed";
  source: { botId: string; botName: string; threadId: string; at: number; quote?: string; messageId?: string };
  updatedAt: number;
  revision: string;
  pinned?: boolean;
  key?: string;
  history?: Array<{ name: string; detail: string; at: number }>;
}

const KINDS: Array<{ kind: Kind; titleKey: LocaleKey; hintKey: LocaleKey }> = [
  { kind: "person", titleKey: "teamMemory.kind.people", hintKey: "teamMemory.kind.peopleHint" },
  { kind: "place", titleKey: "teamMemory.kind.places", hintKey: "teamMemory.kind.placesHint" },
  { kind: "decision", titleKey: "teamMemory.kind.decisions", hintKey: "teamMemory.kind.decisionsHint" },
  { kind: "term", titleKey: "teamMemory.kind.terms", hintKey: "teamMemory.kind.termsHint" },
];

const sectionLabelCls = "m-0 pl-3.5 text-[12px] font-normal leading-4 tracking-[0.01em] text-ink/68";
const rowCls = "flex items-start gap-3 px-3.5 py-2.5";
const metaCls = "mt-0.5 block text-[12px] leading-4 text-ink/56";
const iconButtonCls = "flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-[6px] text-ink/68 transition-[background-color,color] duration-[120ms] ease-[ease] enabled:hover:bg-ink/6 enabled:hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus disabled:cursor-default disabled:opacity-50 aria-pressed:text-ink";

export function TeamMemoryDialog({ section, label, onClose }: { section: string; label: string; onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [loadedIds, setLoadedIds] = useState<string[]>([]);
  const [unsaved, setUnsaved] = useState<Record<string, { name: string; text: string }>>({});
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const busy = useRef(false);
  const generation = useRef(0);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<{ kind: Kind; name: string; detail: string }>({ kind: "term", name: "", detail: "" });
  const query = `section=${encodeURIComponent(section)}`;

  const load = useCallback(async () => {
    const requestGeneration = ++generation.current;
    try {
      const result: { entries: Entry[]; loadedIds: string[] } = await api(`/api/team-memory?${query}`);
      if (generation.current !== requestGeneration) return;
      setEntries(result.entries);
      setLoadedIds(result.loadedIds);
      setError(null);
    } catch (cause) {
      if (generation.current !== requestGeneration) return;
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [query]);

  useEffect(() => {
    setEntries(null);
    setError(null);
    void load();
    return () => { generation.current += 1; };
  }, [load]);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
      if (event.key === "Tab") {
        const controls = dialogRef.current?.querySelectorAll<HTMLElement>("button:enabled, input:enabled, select:enabled");
        if (!controls?.length) return;
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previousFocus?.focus();
    };
  }, [onClose]);

  const run = async (id: string | null, request: () => Promise<{ entries: Entry[]; loadedIds?: string[] }>) => {
    if (busy.current) return false;
    busy.current = true;
    const requestGeneration = ++generation.current;
    setBusyId(id ?? "new");
    setError(null);
    try {
      const result = await request();
      if (generation.current !== requestGeneration) return false;
      setEntries(result.entries);
      setBusyId(null);
      if (result.loadedIds) setLoadedIds(result.loadedIds); else void load();
      return true;
    } catch (cause) {
      if (generation.current === requestGeneration) setError(cause instanceof Error ? cause.message : String(cause));
      return false;
    } finally {
      busy.current = false;
      if (generation.current === requestGeneration) setBusyId(null);
    }
  };

  const accept = (entry: Entry) =>
    run(entry.id, () => api(`/api/team-memory/${entry.id}?${query}`, { method: "PATCH", body: JSON.stringify({ accept: true, expectedRevision: entry.revision }) }));
  const remove = (entry: Entry) => run(entry.id, () => api(`/api/team-memory/${entry.id}?${query}&revision=${entry.revision}`, { method: "DELETE" }));
  const editDetail = (entry: Entry, detail: string, name?: string) => {
    if (detail.trim() === entry.detail && (name === undefined || name === entry.name)) return;
    void run(entry.id, () => api(`/api/team-memory/${entry.id}?${query}`, { method: "PATCH", body: JSON.stringify({ detail, ...(name === undefined ? {} : { name }), expectedRevision: entry.revision }) })).then(saved => setUnsaved(current => {
      const next = { ...current };
      if (saved) delete next[entry.id]; else next[entry.id] = { name: name ?? entry.name, text: detail };
      return next;
    }));
  };
  const add = () => {
    if (!draft.name.trim() || !draft.detail.trim()) return;
    void run(null, () => api(`/api/team-memory?${query}`, { method: "POST", body: JSON.stringify(draft) })).then((saved) => {
      if (!saved) return;
      setDraft({ kind: draft.kind, name: "", detail: "" });
      setAdding(false);
    });
  };

  const proposed = (entries ?? []).filter((entry) => entry.status === "proposed");

  return createPortal(
    <div
      className="ui-dialog-scrim fixed inset-0 z-50 flex items-center justify-center p-4"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="team-memory-title"
        tabIndex={-1}
        className={cn(formSheetCls, "max-h-[min(720px,calc(100dvh-32px))] max-w-[560px]", "focus-visible:outline-none!")}
      >
        <header className={formHeaderCls}>
          <h2 id="team-memory-title" className={formTitleCls}>{t("teamMemory.title", { name: label })}</h2>
          <button onClick={onClose} aria-label={t("teamMemory.close")} className={formCloseCls}>
            <X size={16} />
          </button>
        </header>

        <div className={cn(formBodyCls, "flex flex-col gap-5 pb-4")}>
          <div className="flex flex-col gap-1">
            <p className={cn(rowHintCls, "m-0 text-pretty")}>{t("teamMemory.description")}</p>
            {entries && <p className={cn(footnoteCls, "pl-0")}>{t("teamMemory.loadedSummary", { loaded: loadedIds.length, total: entries.filter(entry => entry.status === "accepted").length })}</p>}
            {error && <p role="alert" className="m-0 text-[12px] leading-4 text-danger">{error} <button onClick={() => void load()} className="cursor-pointer underline">{t("teamMemory.reload")}</button></p>}
            {Object.entries(unsaved).map(([id, draft]) => <p key={id} className={cn(footnoteCls, "pl-0")}><strong className="font-medium text-ink">{draft.name}</strong> · {t("teamMemory.unsaved", { text: draft.text })}</p>)}
          </div>
          {entries === null && !error && (
            <div className="flex min-h-[120px] items-center justify-center text-ink/56">
              <Loader2 size={16} className="animate-spin" aria-label={t("teamMemory.loading")} />
            </div>
          )}

          {proposed.length > 0 && (
            <section className="flex flex-col gap-2">
              <h3 className={sectionLabelCls}>{t("teamMemory.waiting")}</h3>
              <ul className={cn(listCardCls, "m-0 list-none p-0 py-2")}>
                {proposed.map((entry) => (
                  <li key={entry.id} className={rowCls}>
                    <span className="min-w-0 flex-1 text-[13px] leading-[18px]">
                      <span className="text-ink/68">{t(`teamMemory.kind.${entry.kind}`)}: </span>
                      <span className="text-ink">{entry.name}</span>
                      {entry.aliases.length > 0 && <span className="text-ink/68"> ({t("teamMemory.also")} {entry.aliases.join(", ")})</span>}
                      <span className="block text-ink">{entry.detail}</span>
                      <span className={metaCls}>{t("teamMemory.source", { name: entry.source.botName })}{entry.source.quote && ` · ${t("teamMemory.sourceQuote", { quote: entry.source.quote })}`}</span>
                    </span>
                    <button onClick={() => void accept(entry)} disabled={busyId !== null} className={smallButtonCls}>
                      <Check size={12} /> {t("teamMemory.remember")}
                    </button>
                    <button onClick={() => void remove(entry)} disabled={busyId !== null} className={cn(smallButtonCls, "bg-transparent shadow-none text-ink/68 enabled:hover:text-ink")}>
                      {t("teamMemory.skip")}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {entries !== null && entries.filter((entry) => entry.status === "accepted").length === 0 && proposed.length === 0 && (
            <p className={cn(rowHintCls, "m-0 py-3 text-center")}>{t("teamMemory.empty")}</p>
          )}

          {KINDS.map(({ kind, titleKey, hintKey }) => {
            const rows = (entries ?? []).filter((entry) => entry.status === "accepted" && entry.kind === kind);
            if (rows.length === 0) return null;
            return (
              <section key={kind} className="flex flex-col gap-2">
                <h3 className={sectionLabelCls} title={t(hintKey)}>
                  {t(titleKey)}
                </h3>
                <ul className={cn(listCardCls, "m-0 list-none p-0 py-2")}>
                  {rows.map((entry) => (
                    <li key={entry.id} className={rowCls}>
                      <span className="min-w-0 flex-1 text-[13px] leading-[18px]">
                        <span className="text-ink">{entry.name}</span>
                        {entry.aliases.length > 0 && <span className="text-ink/68"> ({t("teamMemory.also")} {entry.aliases.join(", ")})</span>}
                        <input
                          key={entry.revision}
                          defaultValue={entry.detail}
                          disabled={busyId !== null}
                          onBlur={(event) => editDetail(entry, event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") (event.target as HTMLInputElement).blur();
                          }}
                          aria-label={`${entry.name} detail`}
                          className="-mx-1 mt-0.5 block w-[calc(100%+8px)] rounded-[6px] bg-transparent px-1 py-0.5 text-[13px] leading-[18px] text-ink/68 outline-none transition-[background-color] duration-[120ms] ease-[ease] hover:bg-ink/4 focus:bg-ink/4 focus:text-ink"
                        />
                        <span className={metaCls}>
                          {entry.source.botName || t("teamMemory.you")} · {new Date(entry.updatedAt).toLocaleDateString()} · {loadedIds.includes(entry.id) ? t("teamMemory.loaded") : t("teamMemory.searchable")}
                        </span>
                        {!!entry.history?.length && <details className="mt-1 text-[12px] leading-4 text-ink/56"><summary className="cursor-pointer">{t("teamMemory.history")}</summary>{entry.history.map((version, index) => <div key={index} className="mt-1">{new Date(version.at).toLocaleDateString()}: {version.name} · {version.detail} <button disabled={busyId !== null} onClick={() => editDetail(entry, version.detail, version.name)} className="cursor-pointer underline">{t("teamMemory.restore")}</button></div>)}</details>}
                      </span>
                      <button aria-label={t(entry.pinned ? "teamMemory.unpin" : "teamMemory.pin", { name: entry.name })} aria-pressed={entry.pinned ?? false} disabled={busyId !== null} className={iconButtonCls} onClick={() => void run(entry.id, () => api(`/api/team-memory/${entry.id}?${query}`, { method: "PATCH", body: JSON.stringify({ pinned: !entry.pinned, expectedRevision: entry.revision }) }))}><Pin size={14} /></button>
                      <button
                        onClick={() => void remove(entry)}
                        disabled={busyId !== null}
                        aria-label={t("teamMemory.remove", { name: entry.name })}
                        className={iconButtonCls}
                      >
                        <Trash2 size={14} />
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}

          {adding ? (
            <div className={cn(listCardCls, "gap-2 p-3")}>
              <div className="flex flex-wrap items-center gap-2">
                <Select size="sm"
                  value={draft.kind}
                  onChange={(event) => setDraft({ ...draft, kind: event.target.value as Kind })}
                  aria-label={t("teamMemory.kindLabel")}
                >
                  {KINDS.map(({ kind }) => (
                    <option key={kind} value={kind}>
                      {t(`teamMemory.kind.${kind}`)}
                    </option>
                  ))}
                </Select>
                <input
                  value={draft.name}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                  placeholder={t("teamMemory.namePlaceholder")}
                  aria-label={t("teamMemory.nameLabel")}
                  className={cn(textFieldCls, "w-auto min-w-[140px] flex-1")}
                />
              </div>
              <input
                value={draft.detail}
                onChange={(event) => setDraft({ ...draft, detail: event.target.value })}
                onKeyDown={(event) => {
                  if (event.key === "Enter") add();
                }}
                placeholder={t("teamMemory.detailPlaceholder")}
                aria-label={t("teamMemory.detailLabel")}
                className={textFieldCls}
              />
              <div className="flex items-center justify-end gap-2">
                <button onClick={() => setAdding(false)} className={mdSecondaryCls}>
                  {t("common.cancel")}
                </button>
                <button
                  onClick={add}
                  disabled={busyId !== null || !draft.name.trim() || !draft.detail.trim()}
                  className={mdPrimaryCls}
                >
                  {busyId === "new" ? t("teamMemory.adding") : t("teamMemory.add")}
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setAdding(true)}
              className={cn(smallButtonCls, "self-start", entries === null && "hidden")}
            >
              <Plus size={12} /> {t("teamMemory.addEntry")}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
