const RETRIES = [60_000, 300_000, 900_000];

export function createAccountEnroll({ client, localRequest, readMemory, writeMemory, log = () => {}, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let accountId = null, connected = false, inFlight = false, timer = null, generation = 0, closed = false;
  const failures = new Map();
  const cancelTimer = () => { if (timer !== null) clearTimer(timer); timer = null; };
  const current = (id, stamp) => !closed && connected && accountId === id && generation === stamp;
  function attempt() {
    if (closed || !connected || !accountId || inFlight || timer !== null || (failures.get(accountId) ?? 0) > RETRIES.length) return;
    const id = accountId, stamp = generation;
    inFlight = true;
    void Promise.resolve().then(async () => {
      if ((await readMemory())?.accountId === id || !current(id, stamp)) return;
      const grant = await client().enrollGrant();
      if (!current(id, stamp)) return;
      if (!grant) throw new Error("Enrollment unavailable.");
      const response = await localRequest("/api/dashboard/link", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: grant.dashboardUrl, enrollToken: grant.enrollToken }), signal: AbortSignal.timeout(20_000) });
      if (!current(id, stamp)) return;
      if (response.status !== 200) throw new Error("Enrollment refused.");
      const answer = await response.json();
      if (!current(id, stamp)) return;
      if (answer?.claimed !== true || typeof answer.workspaceId !== "string" || !answer.workspaceId) throw new Error("Enrollment unclaimed.");
      await writeMemory({ accountId: id, dashboardUrl: grant.dashboardUrl, workspaceId: answer.workspaceId, at: Date.now() });
    }).catch(() => {
      if (!current(id, stamp)) return;
      const count = (failures.get(id) ?? 0) + 1; failures.set(id, count);
      try { log("account enrollment failed"); } catch {}
      if (count <= RETRIES.length) { timer = setTimer(() => { timer = null; attempt(); }, RETRIES[count - 1]); timer?.unref?.(); }
    }).finally(() => { inFlight = false; if (!closed && generation !== stamp) attempt(); }).catch(() => {});
  }
  return {
    onState(state) {
      if (closed) return;
      try {
        const id = state?.account?.id ?? null;
        if (id !== accountId) { cancelTimer(); accountId = id; generation++; }
        connected = state?.status === "connected";
        attempt();
      } catch {}
    },
    close() { closed = true; generation++; cancelTimer(); },
  };
}
