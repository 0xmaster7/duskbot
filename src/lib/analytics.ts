export function track(_event: string, _props?: Record<string, unknown>): void {}

const GATE_KEY = "omb-email-gate";
export function emailGateDone(): boolean {
  try {
    return Boolean(localStorage.getItem(GATE_KEY));
  } catch {
    return false;
  }
}

export function setEmailGateDone(status: "submitted" | "skipped"): void {
  try {
    localStorage.setItem(GATE_KEY, status);
  } catch {}
}
