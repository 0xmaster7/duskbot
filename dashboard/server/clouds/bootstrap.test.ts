import { execFileSync } from "node:child_process";
import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { dedicatedUserData, homeEnv, linkKeys, originFor, poolBootstrap, shellQuote } from "./bootstrap.ts";

const cloudId = `c${"a".repeat(24)}`;
const input = { cloudId, adminOrigin: "https://admin.example.test", secret: "S".repeat(43), dashboardUrl: "https://dash.example.test", link: { v: 1 as const, url: "https://dash.example.test", workspaceId: "w1", ...linkKeys(), enrolledAt: 123, claimed: true } };
it("generates dashboard-compatible ed25519 keys", () => {
  const keys = linkKeys(), privateKey = createPrivateKey({ key: Buffer.from(keys.privateKey, "base64"), format: "der", type: "pkcs8" }), publicKey = createPublicKey({ key: Buffer.from(keys.publicKey, "base64"), format: "der", type: "spki" });
  expect(verify(null, Buffer.from("report"), publicKey, sign(null, Buffer.from("report"), privateKey))).toBe(true);
});
it("expands only valid https origins", () => {
  expect(originFor(undefined, { ipv4: "203.0.113.2", cloudId })).toBe("https://203-0-113-2.sslip.io");
  expect(originFor("https://{id}.example.test", { ipv4: "203.0.113.2", cloudId })).toBe(`https://${cloudId}.example.test`);
  for (const template of ["http://{id}.example.test", "https://localhost", "https://a.example.test/path", "https://user@a.example.test"]) expect(() => originFor(template, { ipv4: "203.0.113.2", cloudId })).toThrow();
  expect(() => originFor(undefined, { ipv4: "999.0.0.1", cloudId })).toThrow();
});
it("quotes every shell input and writes the boot contract and private link with restrictive modes", () => {
  const value = "quoted'$(touch /tmp/never-cloud)\nvalue";
  expect(execFileSync("bash", ["-c", `printf '%s' ${shellQuote(value)}`], { encoding: "utf8" })).toBe(value);
  const script = dedicatedUserData({ ...input, dashboardUrl: value, version: "1.2.3'$(false)" });
  execFileSync("bash", ["-n"], { input: script });
  const nodeCommand = script.slice(script.indexOf("node -e "), script.indexOf("\nchown maus:maus"));
  const captured = execFileSync("bash", ["-c", `node(){ printf '%s\\0' "$@"; }; ipv4=203.0.113.2; ${nodeCommand}`]);
  const args = captured.toString().split("\0");
  const files = new Map<string, { content: string; mode?: number }>();
  runInNewContext(args[1], { require: () => ({ writeFileSync: (path: string, content: string, options?: { mode: number }) => { files.set(path, { content, ...options }); } }), process: { argv: ["node", args[2], args[3]], exit: () => { throw new Error("invalid"); } }, URL });
  const env = files.get("/home/maus/cloud.env")!;
  expect(env.mode).toBe(0o600); expect(env.content).toContain('OMB_CLOUD_ROLE="home"'); expect(env.content).toContain('OMB_PUBLIC_URL="https://203-0-113-2.sslip.io"');
  expect(env.content).toContain('OMB_DASHBOARD_URL="quoted\'$(touch /tmp/never-cloud)\\nvalue"');
  for (const name of Object.keys(homeEnv({ ...input, origin: "https://home.example.test" }))) expect(env.content).toContain(name);
  expect(files.get("/home/maus/.openmausbot/dashboard-link.json")).toEqual({ mode: 0o600, content: JSON.stringify(input.link) });
  expect(files.get("/etc/caddy/Caddyfile")?.content).toBe("203-0-113-2.sslip.io {\n reverse_proxy 127.0.0.1:8799\n}\n");
  expect(script).toContain("openmausbot serve --no-pair"); expect(script).toContain(shellQuote("openmausbot@1.2.3'$(false)"));
});
it("gives the pool image the same env and link under its data volume", () => {
  const payload = JSON.parse(poolBootstrap({ ...input, origin: `https://${cloudId}.pool.example.test` }));
  expect(payload.env).toMatchObject(homeEnv({ ...input, origin: `https://${cloudId}.pool.example.test` }));
  expect(payload.env.HOME).toBe("/data");
  expect(payload.files).toEqual([{ path: "/data/.openmausbot/dashboard-link.json", mode: 0o600, content: JSON.stringify(input.link) }]);
});
