const OPEN_TEMPLATES = "omb:open-templates";
let hosts = 0;

/** Opens the bot Templates library (TeamLibraryPanel) the sidebar hosts, with its import feedback. False when no
 * sidebar is mounted to host it. */
export function openTemplates(): boolean {
  if (hosts === 0) return false;
  window.dispatchEvent(new Event(OPEN_TEMPLATES));
  return true;
}

export function onOpenTemplates(open: () => void): () => void {
  hosts++;
  window.addEventListener(OPEN_TEMPLATES, open);
  return () => {
    hosts--;
    window.removeEventListener(OPEN_TEMPLATES, open);
  };
}
