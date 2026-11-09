// Routines due while the computer slept wait until it is back on the network. The desktop app says when the computer
// goes to sleep, wakes, and sees the network again; until then the scheduler holds its due runs, then runs each once.
import { z } from "zod";

/** A wake whose "online" never comes (the app quit, a lost event) releases after this much time awake. */
export const LOST_RESUME_MS = 10 * 60_000;

export type WakeEvent = "suspend" | "resume" | "online";

const wakeBody = z.object({ event: z.enum(["suspend", "resume", "online"]) }).strict();

export interface WakeGateOptions {
  /** The scheduler looks again: work held back may be due now. */
  onRelease(): void;
  log?(line: string): void;
  lostResumeMs?: number;
}

export class WakeGate {
  readonly #options: WakeGateOptions;
  #held: "asleep" | "offline" | null = null;
  #heldSince = 0;
  #lost: ReturnType<typeof setTimeout> | null = null;

  constructor(options: WakeGateOptions) {
    this.#options = options;
  }

  held(): boolean {
    return this.#held !== null;
  }

  note(event: WakeEvent): void {
    if (event === "online") {
      this.#release("the network is back");
      return;
    }
    if (this.#held === null) this.#heldSince = performance.now();
    const was = this.#held;
    this.#held = event === "suspend" ? "asleep" : "offline";
    if (was !== this.#held) this.#options.log?.(event === "suspend" ? "routines: held while this computer sleeps" : "routines: held until this computer is back on the network");
    // Node's timers stand still while the computer sleeps, so this counts time awake.
    if (this.#lost) clearTimeout(this.#lost);
    this.#lost = setTimeout(() => this.#release("no word from the desktop app since it woke"), this.#options.lostResumeMs ?? LOST_RESUME_MS);
    this.#lost.unref?.();
  }

  /** POST /api/routines/wake: `{ event }` from the desktop app. */
  answer(body: unknown): { status: number; body: Record<string, unknown> } {
    const parsed = wakeBody.safeParse(body);
    if (!parsed.success) return { status: 400, body: { error: "event must be suspend, resume or online" } };
    this.note(parsed.data.event);
    return { status: 200, body: { held: this.held() } };
  }

  stop(): void {
    if (this.#lost) clearTimeout(this.#lost);
    this.#lost = null;
  }

  #release(why: string): void {
    if (this.#lost) clearTimeout(this.#lost);
    this.#lost = null;
    if (this.#held === null) return;
    this.#held = null;
    this.#options.log?.(`routines: released after ${Math.round((performance.now() - this.#heldSince) / 1_000)} s awake (${why})`);
    this.#options.onRelease();
  }
}
