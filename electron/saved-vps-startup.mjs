const LINKED_STAGES = new Set(["linked", "moved"]);

export function savedVpsStartupTarget({ packaged, hidden, remoteAccess, active, link, priority, cloudHome, rememberedPlace }) {
  if (!packaged || hidden || remoteAccess || priority || cloudHome || rememberedPlace || !active || active.kind !== "remote" || active.team || active.cloud || active.home) return null;
  if (!LINKED_STAGES.has(link?.stage) || !["relay", "direct"].includes(link.mode) || link.server?.id !== active.id || link.server.origin !== active.origin) return null;
  return { id: active.id, origin: active.origin };
}

export function startPackagedAlongsideVps({ startLocal, target, ready, open, failed = () => {} }) {
  const local = Promise.resolve().then(startLocal);
  const localSettled = local.then(() => null, () => null);
  const selected = target();
  const remote = selected ? (async () => {
    try {
      const prepared = await Promise.race([ready(selected.id), localSettled]);
      const current = target();
      if (!prepared || !current || current.id !== selected.id || current.origin !== prepared.origin) return false;
      return (await open(prepared)) !== false;
    } catch (error) {
      failed(error);
      return false;
    }
  })() : Promise.resolve(false);
  return { local, remote };
}

export async function waitForLocalStartup(starting, timeoutMs = 60_000) {
  let deadline;
  try {
    await Promise.race([Promise.resolve(starting).catch(error => {
      throw new Error("This computer's background server is unavailable. Restart the app and try again.", { cause: error });
    }), new Promise((_, reject) => {
      deadline = setTimeout(() => reject(new Error("This computer is still starting. Try again shortly.")), timeoutMs);
    })]);
  } finally {
    clearTimeout(deadline);
  }
}
