const OPEN_TEMPLATES = "omb:open-templates";

/** Opens the bot Templates library (TeamLibraryPanel), which the sidebar hosts. */
export function openTemplates(): void {
  window.dispatchEvent(new Event(OPEN_TEMPLATES));
}

export function onOpenTemplates(open: () => void): () => void {
  window.addEventListener(OPEN_TEMPLATES, open);
  return () => window.removeEventListener(OPEN_TEMPLATES, open);
}
