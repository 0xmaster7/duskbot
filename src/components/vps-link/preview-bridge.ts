// dev-only: a fake desktop side for /settings-preview.html?vps=command|installing|failed|linked|moving|moved, so every
// screen of Add your VPS and the Transfer pane draws without a relay or a server
import { EMPTY_VIEW, VPS_STEP_IDS, type VpsLinkBridge, type VpsLinkView } from "@/lib/vps-link";

const COMMAND = "curl -fsSL https://link.apps.siddz.com/i/ab3d7fgh2k-q4mxw7e2r5t6y7u8i9o2p3a4s5 | sh";
const SERVER = { id: "vps-1", name: "Oracle VPS", origin: "http://vps-ab3d7fgh2k.localhost:47811" };

function viewFor(stage: string): VpsLinkView {
  const steps = (done: number, running?: number, failed?: number) => VPS_STEP_IDS.map((id, index) => ({
    id, status: index < done ? (id === "desktop" ? "skipped" as const : "done" as const) : index === running ? "running" as const : index === failed ? "failed" as const : "waiting" as const,
    ...(index === failed ? { log: "+ curl -fsSL https://deb.nodesource.com/setup_24.x\ncurl: (6) Could not resolve host: deb.nodesource.com\nE: Unable to fetch some archives, maybe run apt-get update" } : {}),
  }));
  const command = { ...EMPTY_VIEW, stage: "command" as const, command: COMMAND, expiresAt: Date.now() + 27 * 60_000 };
  if (stage === "installing") return { ...command, stage: "installing", steps: steps(5, 5) };
  if (stage === "failed") return { ...command, stage: "installing", steps: steps(4, undefined, 4) };
  if (stage === "linked") return { ...command, stage: "linked", steps: steps(11), server: SERVER, mode: "relay" };
  if (stage === "moving") return { ...command, stage: "moving", steps: steps(11), server: SERVER, move: { step: "copy", status: "running", chats: { done: 9, total: 23 } } };
  if (stage === "moved") return { ...command, stage: "moved", steps: steps(11), server: SERVER, move: { step: "done", status: "done" } };
  return command;
}

export function previewVpsBridge(stage: string): VpsLinkBridge {
  let view = viewFor(stage);
  const same = async () => view;
  return {
    state: same, start: same, cancel: same, reset: same,
    engines: async () => [
      { instanceId: "claude", kind: "claude", name: "Claude Code", signedIn: true },
      { instanceId: "codex", kind: "codex", name: "Codex", signedIn: false },
    ],
    signIn: async () => ({ flowId: "f1", phase: "waiting", authorizationUrl: "https://auth.openai.com/codex/device", userCode: "QK7M-4XPD", needsCode: false }),
    signInStatus: async () => ({ flowId: "f1", phase: "waiting", authorizationUrl: "https://auth.openai.com/codex/device", userCode: "QK7M-4XPD", needsCode: false }),
    signInCode: async () => ({ ok: true }), signInCancel: async () => ({ ok: true }), openUrl: async () => {},
    preview: async () => ({ bots: [{ id: "b1", name: "Pixel" }, { id: "b2", name: "Scout" }, { id: "b3", name: "Ledger" }], chats: 23, messages: null, skills: 6, memories: null, routines: 4, apps: null, bytes: 187_000_000 }),
    move: async () => (view = viewFor("moving")),
    open: async () => {},
    where: async () => ({ place: "vps", server: SERVER }),
    backups: async () => [
      { id: "k2", at: Date.now() - 3_600_000, bytes: 192_000_000, reason: "before-move", summary: { bots: 3, chats: 23, skills: 6, routines: 4 } },
      { id: "k1", at: Date.now() - 6 * 86_400_000, bytes: 88_000_000, reason: "manual", summary: { bots: 2, chats: 11, skills: 3, routines: 1 } },
    ],
    backupNow: async () => ({ id: "k3" }), restore: async () => ({ ok: true, restart: true }), moveBack: async () => ({ ok: true }), forget: same,
    onChange: () => () => {},
  };
}
