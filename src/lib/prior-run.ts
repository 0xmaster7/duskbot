// Read before main.tsx's first-paint writes: applySkin stamps dusk-skin on every boot.
const PRIOR_RUN_KEYS = ["dusk-skin", "dusk-installed", "dusk-email-gate", "dusk-drafts", "dusk-show-threads"];

export function hasPriorRun(store: Pick<Storage, "getItem"> | undefined): boolean {
  try {
    return PRIOR_RUN_KEYS.some((key) => store?.getItem(key) != null);
  } catch {
    return false;
  }
}
