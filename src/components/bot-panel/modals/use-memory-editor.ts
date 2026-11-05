import { useState } from "react";

import { t } from "@/lib/i18n";
import { deleteMemoryDoc, MEMORY_INDEX, saveMemoryDoc, type MemoryDoc } from "@/lib/memory";
import type { Bot } from "@/state/store";
import { panelMemoryNotes, withMemoryNote, withoutMemoryNote, type PanelMemoryNote } from "../memory-notes";
import { useMemoryDoc } from "../use-memory-doc";

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/** MEMORY.md's bullets, and on a Team Cloud the person's own notes. Every write goes through the memory file route with
 * the hash it was read at, so a note the bot added meanwhile is never lost: a conflict re-reads and asks again. */
export function useMemoryEditor(bot: Bot) {
  const memory = useMemoryDoc(bot);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const memoryOn = bot.memoryEnabled !== false;
  const notes = memory.docs ? panelMemoryNotes(memory.docs) : null;
  const index = memory.docs?.find((doc) => doc.path === MEMORY_INDEX) ?? null;

  const change = async (save: () => Promise<boolean>) => {
    if (saving) return false;
    setSaving(true);
    setError(null);
    try {
      return await save();
    } catch (cause) {
      setError(errorText(cause, t("botPanel.library.memoryError")));
      return false;
    } finally {
      setSaving(false);
    }
  };
  const write = (doc: MemoryDoc, text: string) => change(async () => {
    const result = await saveMemoryDoc(bot.id, doc.path, text, doc.exists ? doc.hash : undefined, memory.mine);
    if (result.ok) {
      memory.setDoc(result.doc);
      return true;
    }
    await memory.reload();
    setError(t("memory.conflict.title", { name: bot.name }));
    return false;
  });
  const forget = (note: PanelMemoryNote) => {
    const doc = memory.docs?.find((candidate) => candidate.path === note.path);
    if (!doc) return;
    if (note.line !== null) void write(doc, withoutMemoryNote(doc.text, note.line));
    else void change(async () => {
      await deleteMemoryDoc(bot.id, doc.path, memory.mine);
      await memory.reload();
      return true;
    });
  };
  const add = async () => {
    if (!index || !draft.trim()) return;
    if (await write(index, withMemoryNote(index.text, draft))) setDraft("");
  };

  return { memoryOn, readError: memory.error, notes, index, draft, setDraft, saving, error, forget, add };
}
