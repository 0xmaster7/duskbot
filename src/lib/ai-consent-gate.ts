// The phone app asks before anything it sends reaches an AI (App Store guideline 5.1.2(i)); the desktop installs no gate.

export interface AiConsentGate {
  allowed(): boolean;
  /** shows the question; `retry` sends what was held back once the person allows it */
  ask(retry?: () => void): void;
}

let installed: AiConsentGate | null = null;

export function installAiConsentGate(gate: AiConsentGate): () => void {
  installed = gate;
  return () => { if (installed === gate) installed = null; };
}

/** True where nothing stands in the way; otherwise asks, and `retry` runs if the person allows. */
export function aiSendAllowed(retry?: () => void): boolean {
  if (!installed || installed.allowed()) return true;
  installed.ask(retry);
  return false;
}
