// Security: My Cloud takes a password, a 2FA key, a 1Password token or an API key from a remote client only sealed for
// its server process, so a move seals them as the app's pages do: for the key My Cloud's identity signed, for one
// purpose and target. No identity is pinned for My Cloud, the same trust its pages get.

// the sources when they are there (dev, tests), else the bundle package:prepare made (the packaged app has no .ts)
let loaded = null;
const deps = () => (loaded ??= import("./seal/deps.ts").catch(() => import("./seal/deps.bundle.mjs")));

const record = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

/**
 * Seals for `session` (`{ call(method, route, body?) }`, answering `{ ok, status, body }`). The key is fetched once;
 * a server that restarted since answers `seal_required` with its new key, and this seals once more for that.
 */
export function cloudSealer(session) {
  let key = null;
  async function sealKey() {
    if (key) return key;
    const answer = await session.call("GET", "/api/seal-key");
    if (!answer.ok || !record(answer.body?.sealKey)) throw new Error("My Cloud did not offer a key to seal secrets for.");
    return (key = answer.body.sealKey);
  }
  /** `values` sealed for `purpose` and `target`, sent as `build(sealed)`; none to seal sends `build(null)`. */
  async function send(method, route, purpose, target, values, build) {
    const named = Object.fromEntries(Object.entries(values).filter(([, value]) => typeof value === "string" && value !== ""));
    if (!Object.keys(named).length) return session.call(method, route, build(null));
    const { sealValues } = await deps();
    const first = await sealKey();
    const answer = await session.call(method, route, build(await sealValues(named, first, purpose, target)));
    const fresh = answer.body?.sealKey;
    if (answer.ok || !record(fresh) || fresh.keyId === first.keyId) return answer;
    key = fresh;
    return session.call(method, route, build(await sealValues(named, fresh, purpose, target)));
  }
  return {
    async login(login, rest) {
      const { loginSealTarget, normalizeLoginHost } = await deps();
      const target = loginSealTarget(normalizeLoginHost(login.site) ?? String(login.site ?? "").trim(), login.username);
      const secrets = { password: login.password, ...(login.totp ? { totp: login.totp } : {}) };
      return send("POST", "/api/logins", "login.create", target, secrets, (sealed) => ({ site: login.site, username: login.username, ...rest, ...(sealed ? { sealed } : {}) }));
    },
    /** A Vault secret, bound to its label; `bots`: those of its bots that are on My Cloud. */
    vaultSecret(secret, bots) {
      return send("POST", "/api/cloud-send/vault/secret", "vault.secret", [String(secret.label).trim().toLowerCase()], { value: secret.value },
        (sealed) => ({ label: secret.label, bots, ...(sealed ? { sealed } : {}) }));
    },
    /** A card's file secret, bound to its bot, conversation and card. */
    cardFile(file) {
      return send("POST", "/api/cloud-send/vault/file", "card.secret", [file.bot, file.thread, file.card], { value: file.value },
        (sealed) => ({ bot: file.bot, thread: file.thread, card: file.card, ...(sealed ? { sealed } : {}) }));
    },
    onePassword(token) {
      return send("POST", "/api/logins/1password", "onepassword.connect", [], { token }, (sealed) => (sealed ? { sealed } : {}));
    },
    async config(method, patch) {
      const { configSecrets } = await deps();
      const secrets = configSecrets(patch);
      if (!secrets.size) return session.call(method, "/api/config", patch);
      const paths = [...secrets.keys()].sort();
      const rest = withoutPaths(patch, paths);
      return send(method, "/api/config", "config", paths, Object.fromEntries(secrets), (sealed) => ({ ...rest, sealed, sealedPaths: paths }));
    },
  };
}

function withoutPaths(patch, paths) {
  const copy = structuredClone(patch);
  for (const path of paths) {
    const parts = path.split(".");
    const parent = parts.slice(0, -1).reduce((node, part) => node?.[part], copy);
    if (record(parent)) delete parent[parts.at(-1)];
  }
  return copy;
}
