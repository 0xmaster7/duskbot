import { createServer } from "node:http";
import { createHash, randomBytes, randomInt } from "node:crypto";

export async function startFakeAdmin({ port = 0 }: { port?: number } = {}) {
  const codes = new Map<string, string>();
  const attempts = new Map<string, { email: string; code: string; expiresAt: number; tries: number }>();
  const sessions = new Set<string>();
  const server = createServer(async (req, res) => {
    function json(status: number, value: unknown) {
      res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify(value));
    }
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 4096) return json(413, { error: "Request is too large.", code: "too_large" });
        chunks.push(Buffer.from(chunk));
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as Record<string, unknown>;
      if (req.method === "POST" && req.url === "/api/cloud/app/sign-in/start") {
        if (typeof body.email !== "string" || !body.email.includes("@") || body.deviceName !== "OpenMausBot dashboard" || body.platform !== "linux" || body.appVersion !== "1.0.0") return json(400, { error: "Invalid request.", code: "invalid_request" });
        const email = body.email.trim().toLowerCase();
        const attempt = randomBytes(32).toString("base64url");
        const code = randomInt(0, 100_000_000).toString().padStart(8, "0");
        codes.set(email, code);
        attempts.set(attempt, { email, code, expiresAt: Date.now() + 10 * 60_000, tries: 0 });
        return json(200, { cloudContractVersion: 1, attempt, expiresIn: 600, resendAfter: 30, signupOpen: true });
      }
      if (req.method === "POST" && req.url === "/api/cloud/app/sign-in/verify") {
        const attempt = typeof body.attempt === "string" ? attempts.get(body.attempt) : undefined;
        if (!attempt || attempt.expiresAt <= Date.now() || attempt.tries >= 5) return json(410, { error: "Sign-in expired.", code: "expired" });
        if (body.code !== attempt.code) { attempt.tries++; return json(400, { error: "Code is incorrect.", code: "invalid_code" }); }
        attempts.delete(body.attempt as string);
        const accessToken = `omc_${randomBytes(32).toString("base64url")}`;
        sessions.add(accessToken);
        return json(200, { cloudContractVersion: 1, accessToken, expiresAt: Date.now() + 30 * 24 * 60 * 60_000,
          device: { id: `dev_${randomBytes(8).toString("hex")}` }, account: { id: `acct_${createHash("sha256").update(attempt.email).digest("hex").slice(0, 24)}`, email: attempt.email } });
      }
      if (req.method === "DELETE" && req.url === "/api/cloud/desktop/session") {
        const token = req.headers.authorization?.replace(/^Bearer /, "");
        if (!token || !sessions.delete(token)) return json(401, { error: "Session is invalid.", code: "signed_out" });
        return json(200, { ok: true });
      }
      json(404, { error: "Route not found.", code: "not_found" });
    } catch { json(400, { error: "Invalid request.", code: "invalid_request" }); }
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fake Admin did not start.");
  return {
    url: `http://127.0.0.1:${address.port}`,
    codes,
    close: () => new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); }),
  };
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const index = process.argv.indexOf("--port");
  const port = index < 0 ? 7481 : Number(process.argv[index + 1]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid port.");
  const admin = await startFakeAdmin({ port });
  const printed = new Map<string, string>();
  setInterval(() => {
    for (const [email, code] of admin.codes) if (printed.get(email) !== code) {
      console.log(`code for ${email}: ${code}`);
      printed.set(email, code);
    }
  }, 100).unref();
  console.log(`fake Admin listening on ${admin.url}`);
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => { void admin.close(); });
}
