export const accountGateRequired = ({ env, packaged, remote, custom }) => !remote && env.DUSK_ALLOW_SIGNED_OUT !== "1" && (packaged || custom);
export const gateBlocks = state => !(state?.account && ["connected", "unavailable"].includes(state.status));
const plain = value => typeof value === "string" ? value : "";

/** `plainStorage()`: no system keyring, so a sign-in is kept in a file guarded only by this computer's user account. */
export function installAccountGate({ ipcMain, guard, client, required, window, restored = async () => {}, plainStorage = () => false }) {
  const view = state => {
    const needed = required();
    return { required: needed, blocked: needed && gateBlocks(state), status: state?.status ?? "signed-out",
      ...(state?.message === undefined ? {} : { message: state.message }), ...(state?.enrollment ? { enrollment: { userCode: state.enrollment.userCode, expiresAt: state.enrollment.expiresAt } } : {}),
      ...(state?.status === "connecting" && state.browser ? { browser: state.browser } : {}), ...(plainStorage() ? { plainStorage: true } : {}) };
  };
  const state = () => view(client().state());
  const handle = (method, handler) => ipcMain.handle(`account-gate:${method}`, guard(`account-gate:${method}`, handler));
  // a kept sign-in is still being read at launch: answer after it, so a signed-in window never flashes the gate
  handle("state", async () => { if (client().state()?.message === "restoring") await restored(); return state(); });
  handle("signInStart", (_event, email, options) => client().emailStart(plain(email), { recover: options?.recover === true }));
  handle("options", () => client().signInOptions());
  handle("signInVerify", async (_event, code) => {
    const result = await client().emailVerify(plain(code));
    return { outcome: result.outcome, ...(result.triesLeft === undefined ? {} : { triesLeft: result.triesLeft }) };
  });
  handle("signInCancel", () => { client().emailCancel(); });
  handle("browser", async (_event, provider) => { await client().begin(null, { provider: plain(provider) }); return state(); });
  handle("cancel", async () => { await client().cancel(); return state(); });
  handle("reopen", async () => { await client().reopen(); return state(); });
  return { changed(value) { const target = window(); if (target && !target.isDestroyed()) target.webContents.send("account-gate:changed", view(value)); } };
}
