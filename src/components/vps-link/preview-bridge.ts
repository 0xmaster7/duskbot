// dev-only: a fake desktop side for /settings-preview.html?vps=<stage>, so every screen of Add your VPS and the Transfer
// pane draws without a link service or a server. Stages: command, installing (plays the first steps), failed, linked
// (links while watching, for the cheer), signin, ready (every AI signed in, so the move), moving, paused, moved, and play
// (ready, then a scripted move once Move is pressed).
import { EMPTY_VIEW, VPS_STEP_IDS, type VpsLinkBridge, type VpsLinkMove, type VpsLinkView } from "@/lib/vps-link";

const COMMAND = "curl -fsSL https://link.apps.siddz.com/i/ab3d7fgh2k-q4mxw7e2r5t6y7u8i9o2p3a4s5 | sh";
const SERVER = { id: "vps-1", name: "Oracle VPS", origin: "http://vps-ab3d7fgh2k.localhost:47811" };
const FAILED_LOG = "+ curl -fsSL https://deb.nodesource.com/setup_24.x\ncurl: (6) Could not resolve host: deb.nodesource.com\nE: Unable to fetch some archives, maybe run apt-get update";

const steps = (done: number, running?: number, failed?: number) => VPS_STEP_IDS.map((id, index) => ({
  id, status: index < done ? (id === "desktop" ? "skipped" as const : "done" as const) : index === running ? "running" as const : index === failed ? "failed" as const : "waiting" as const,
  ...(index === failed ? { log: FAILED_LOG } : {}),
}));
const command: VpsLinkView = { ...EMPTY_VIEW, stage: "command", command: COMMAND, expiresAt: Date.now() + 27 * 60_000 };
const linked: VpsLinkView = { ...command, stage: "linked", steps: steps(11), server: SERVER, mode: "relay" };
const moving = (move: VpsLinkMove): VpsLinkView => ({ ...linked, stage: "moving", move });

function viewFor(stage: string): VpsLinkView {
  if (stage === "installing" || stage === "linked") return { ...command, stage: "installing", steps: steps(0, 0) };
  if (stage === "failed") return { ...command, stage: "installing", steps: steps(4, undefined, 4) };
  if (stage === "signin" || stage === "ready" || stage === "play") return linked;
  if (stage === "moving") return moving({ step: "copy", status: "running", chats: { done: 9, total: 23 } });
  if (stage === "paused") return moving({ step: "verify", status: "failed", error: "Two chats did not arrive." });
  if (stage === "moved") return { ...linked, stage: "moved", move: { step: "done", status: "done" } };
  return command;
}

// the scripted move: the backup, the chats copying in steps (so the bots land one by one), the check and the clear
const PLAY: Array<[number, VpsLinkMove]> = [
  [0, { step: "backup", status: "running" }],
  [700, { step: "copy", status: "running", chats: { done: 0, total: 23 } }],
  [1700, { step: "copy", status: "running", chats: { done: 5, total: 23 } }],
  [2900, { step: "copy", status: "running", chats: { done: 9, total: 23 } }],
  [4100, { step: "copy", status: "running", chats: { done: 14, total: 23 } }],
  [5300, { step: "copy", status: "running", chats: { done: 19, total: 23 } }],
  [6500, { step: "verify", status: "running" }],
  [7300, { step: "empty", status: "running" }],
  [8000, { step: "done", status: "done" }],
];

export function previewVpsBridge(stage: string): VpsLinkBridge {
  let view = viewFor(stage);
  const listeners = new Set<(view: VpsLinkView) => void>();
  const emit = (next: VpsLinkView) => { view = next; for (const listen of listeners) listen(next); };
  const same = async () => view;
  // the install plays its first steps so the mirror has times on it; ?vps=linked then links
  if (stage === "installing" || stage === "linked") {
    const last = stage === "linked" ? 11 : 5;
    for (let index = 1; index <= last; index++) setTimeout(() => emit({ ...view, steps: steps(index, index) }), 300 + index * 380);
    if (stage === "linked") setTimeout(() => emit(linked), 300 + 12 * 380);
  }
  const signedIn = stage === "ready" || stage === "play" || stage === "moving" || stage === "paused" || stage === "moved";
  return {
    state: same, start: same, cancel: same, reset: same,
    engines: async () => [
      { instanceId: "claude", kind: "claude", name: "Claude Code", signedIn: true },
      { instanceId: "codex", kind: "codex", name: "Codex", signedIn },
    ],
    signIn: async () => ({ flowId: "f1", phase: "waiting", authorizationUrl: "https://auth.openai.com/codex/device", userCode: "QK7M-4XPD", needsCode: false }),
    signInStatus: async () => ({ flowId: "f1", phase: "waiting", authorizationUrl: "https://auth.openai.com/codex/device", userCode: "QK7M-4XPD", needsCode: false }),
    signInCode: async () => ({ ok: true }), signInCancel: async () => ({ ok: true }), openUrl: async () => {},
    preview: async () => ({
      bots: [{ id: "b1", name: "Pixel" }, { id: "b2", name: "Scout" }, { id: "b3", name: "Ledger" }, { id: "b4", name: "Quill" }, { id: "b5", name: "Ember" }],
      chats: 23, messages: 1840, skills: 6, memories: 41, routines: 4, apps: 3, bytes: 187_000_000,
    }),
    move: async () => {
      for (const [at, move] of PLAY.slice(1)) setTimeout(() => emit(move.step === "done" ? { ...linked, stage: "moved", move } : moving(move)), at);
      return (view = moving(PLAY[0]![1]));
    },
    retryMove: same,
    open: async () => {},
    where: async () => ({ place: "vps", server: SERVER }),
    backups: async () => [
      { id: "k2", at: Date.now() - 3_600_000, bytes: 192_000_000, reason: "before-move", summary: { bots: 3, chats: 23, skills: 6, routines: 4 } },
      { id: "k1", at: Date.now() - 6 * 86_400_000, bytes: 88_000_000, reason: "manual", summary: { bots: 2, chats: 11, skills: 3, routines: 1 } },
    ],
    backupNow: async () => ({ id: "k3" }), restore: async () => ({ ok: true, restart: true }), moveBack: async () => ({ ok: true }), forget: same,
    onChange: (callback) => { listeners.add(callback); return () => { listeners.delete(callback); }; },
  };
}
