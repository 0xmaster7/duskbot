// Wires Files into the desktop app: the service with Electron's pieces, and its channels for this computer's own window
// only. A folder reaches `share` only as a token for one the person picked (or the app suggested and checked) here.
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createCloudFilesService } from "./cloud-sync.mjs";
import { createDownloadMarker } from "./cloud-sync-mark.mjs";

const TOKEN_MS = 30 * 60_000;

/** Whose Files this folder keeps: the first account to use it, as it was before there could be several. Another account's
 * are in a folder of their own, so a folder one account shares is never registered on another's Cloud. */
export function filesFolderOf(root, accountId, read = (file) => { try { return JSON.parse(fs.readFileSync(file, "utf8")).accountId ?? null; } catch { return null; } },
  write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value), { mode: 0o600 }); }) {
  const owner = path.join(root, "account.json"), first = read(owner);
  if (!first) write(owner, { accountId });
  return !first || first === accountId ? root : path.join(root, "accounts", createHash("sha256").update(accountId).digest("hex").slice(0, 32));
}

/** `stateDir`: Files' own folder under userData; the staging Admin keeps its own (cloud-account.mjs cloudTarget). */
export function installCloudFiles({ app, ipcMain, dialog, shell, powerMonitor, fetch, localWorkspaceOnly, send, cloudOrigin, cloudAccount, localDataDir, power, now = Date.now, stateDir = "cloud-sync", makeService = createCloudFilesService }) {
  const root = path.join(app.getPath("userData"), stateDir);
  const open = (dir) => makeService({
    settingsFile: path.join(dir, "settings.json"), stateFile: path.join(dir, "state.db"),
    documentsDir: app.getPath("documents"), homeDir: app.getPath("home"), localDataDir, cloudOrigin, fetch, ...(power ? { power } : {}),
    trashItem: (file) => shell.trashItem(file), markDownloaded: createDownloadMarker(),
    onChange: (state) => send("files:state-changed", state),
  });
  let dir = root, service = open(dir), started = false;
  const tokens = new Map();
  const issue = (checked) => {
    for (const [token, entry] of tokens) if (entry.at + TOKEN_MS < now()) tokens.delete(token);
    const token = randomUUID();
    if (!checked.refusal) tokens.set(token, { pcPath: checked.pcPath, at: now() });
    return { token, ...checked };
  };
  const pick = async () => {
    const picked = await dialog.showOpenDialog({ properties: ["openDirectory"] });
    return picked.canceled || !picked.filePaths[0] ? null : picked.filePaths[0];
  };
  const handle = (channel, work) => ipcMain.handle(channel, localWorkspaceOnly(channel, work));
  handle("files:state", () => service.state());
  handle("files:pick", async () => {
    const picked = await pick();
    return picked ? issue(await service.check(picked)) : null;
  });
  handle("files:check", async (_event, paths) => {
    if (!Array.isArray(paths) || paths.length > 20 || !paths.every((value) => typeof value === "string" && value.length <= 4096)) throw new Error("Invalid folders.");
    return Promise.all(paths.map(async (value) => issue(await service.check(value))));
  });
  handle("files:share", async (_event, token) => {
    const entry = typeof token === "string" ? tokens.get(token) : null;
    if (!entry) throw new Error("Choose the folder again.");
    tokens.delete(token);
    return service.share(entry.pcPath);
  });
  const folderId = (value) => {
    if (typeof value !== "string" || !/^[\w-]{1,200}$/.test(value)) throw new Error("Invalid folder.");
    return value;
  };
  handle("files:stop", (_event, id) => service.stopSharing(folderId(id)));
  handle("files:deletes", (_event, id, remove) => service.answerDeletes(folderId(id), remove === true));
  handle("files:locate", async (_event, id) => {
    const picked = await pick();
    return picked ? service.relocate(folderId(id), picked) : service.state();
  });
  handle("files:outputs", (_event, enabled) => service.setOutputs(enabled === true));
  handle("files:open", async (_event, target) => {
    const folder = service.localFolder(target?.outputs === true ? { outputs: true } : { folderId: folderId(target?.folderId) });
    if (folder) await shell.openPath(folder);
  });
  handle("files:more-space", async () => { await cloudAccount().openDashboard(); });
  powerMonitor.on("resume", () => service.wake());
  const start = () => {
    started = true;
    service.start();
  };
  /** The signed-in account changed: its own Files go on, and nothing recorded for the one before applies. */
  const accountChanged = (accountId) => {
    if (!accountId) return;
    const next = filesFolderOf(root, accountId);
    if (next === dir) return;
    service.close();
    dir = next;
    service = open(dir);
    tokens.clear();
    if (started) service.start();
  };
  return { start, accountChanged, running: () => service.running(), close: () => service.close() };
}
