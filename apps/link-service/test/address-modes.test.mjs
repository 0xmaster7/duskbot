// the ways a server is reached, chosen on the one line (`| sh -s -- --tailscale`): what the installer accepts, what it
// writes for the agent, what the agent tells the app, and what the link service lets through to the app
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

import { currentAddress } from "../agent.mjs";
import { installerAsk } from "../src/app.mjs";

const run = promisify(execFile);
const script = (await readFile(new URL("../install.sh", import.meta.url), "utf8")).replace(/\nmain "\$@"\s*$/, "\n");

async function sourced(body, args = []) {
  const dir = await mkdtemp(join(tmpdir(), "omb-ways-"));
  try {
    const file = join(dir, "fixture.sh");
    await writeFile(file, `${script}
STATE=${dir}/state ADDRESS=${dir}/address.json UNITS=${dir}/units
mkdir -p "$STATE" "$UNITS"
${body}
`);
    const out = await run("sh", [file, ...args], { env: { PATH: "/usr/bin:/bin", TERM: "dumb" } }).then((done) => done, (error) => error);
    let address = null;
    try { address = JSON.parse(await readFile(join(dir, "address.json"), "utf8")); } catch { /* none written */ }
    return { stdout: out.stdout, stderr: out.stderr, code: out.code ?? 0, address };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
const parsed = (args) => sourced('parse_ways "$@"; printf "%s|%s|%s\\n" "$WANT" "$WANT_DOMAIN" "$ARGS_WANT"', ["abcdefghij-abcdefghijklmnopqrstuvwxyz", ...args]);

describe("the line's way", () => {
  it("takes each way after the token, and a domain alone as the own-domain way", async () => {
    expect((await parsed([])).stdout.trim()).toBe("||");
    expect((await parsed(["--tailscale"])).stdout.trim()).toBe("tailscale||tailscale");
    expect((await parsed(["--cloudflare"])).stdout.trim()).toBe("cloudflare||cloudflare");
    expect((await parsed(["--ssh"])).stdout.trim()).toBe("ssh||ssh");
    expect((await parsed(["--domain", "https://Bots.Example.com/"])).stdout.trim()).toBe("domain|bots.example.com|domain");
    expect((await parsed(["--cloudflare", "--domain=bots.example.com"])).stdout.trim()).toBe("cloudflare|bots.example.com|cloudflare");
  });

  it("hands the way on to root's run of the script, keys never on the command line", async () => {
    const args = (list) => sourced('parse_ways "$@"; way_args', ["abcdefghij-abcdefghijklmnopqrstuvwxyz", ...list]);
    expect((await args(["--tailscale", "--tailscale-key", "tskey-secret"])).stdout).toBe("--tailscale");
    expect((await args(["--domain", "bots.example.com"])).stdout).toBe("--domain bots.example.com");
    expect((await args(["--cloudflare", "--domain", "b.example.com"])).stdout).toBe("--cloudflare --domain b.example.com");
    expect((await args([])).stdout).toBe("");
  });

  it("refuses what it does not know, and a domain that is not one, before doing anything", async () => {
    const unknown = await parsed(["--tailscal"]);
    expect(unknown.code).toBe(1);
    expect(unknown.stderr).toContain("Unknown option --tailscal");
    const bad = await parsed(["--domain", "localhost"]);
    expect(bad.code).toBe(1);
    expect(bad.stderr).toContain("is not a domain name");
    expect((await parsed(["--tailscale", "--domain", "a.example.com"])).stderr).toContain("--domain goes alone");
  });

  it("writes the address the agent reads: pinned for its own caddy, not for a quick tunnel, whose name it looks up", async () => {
    const domain = await sourced("use_address direct domain bots.example.com 1");
    expect(domain.address).toEqual({ v: 1, mode: "direct", via: "domain", host: "bots.example.com", pin: true });
    const quick = await sourced("use_address direct cloudflare abc-def.trycloudflare.com 0");
    expect(quick.address).toEqual({ v: 1, mode: "direct", via: "cloudflare", host: "abc-def.trycloudflare.com", pin: false, quick: "http://127.0.0.1:20241/quicktunnel" });
    const relay = await sourced("WANT=ssh; relay_address");
    expect(relay.address).toMatchObject({ mode: "relay", via: "ssh" });
  });

  it("names a public address to the server only where it stays put", async () => {
    const unit = (via, named = "") => sourced(`TMP=$STATE; HARDENING=; NAME=box; put_file() { cat "$TMP/new"; }; state_set mode direct; state_set host h.example.com; state_set via ${via}; state_set cf-named "${named}"; server_unit`);
    expect((await unit("tailscale")).stdout).toContain("--public-url https://h.example.com");
    expect((await unit("cloudflare")).stdout).not.toContain("--public-url");
    expect((await unit("cloudflare", "1")).stdout).toContain("--public-url https://h.example.com");
  });
});

describe("the agent's word on where its server is", () => {
  const read = (value) => () => JSON.stringify(value);
  it("reads the relay, a pinned address with its key, and a quick tunnel's current name", async () => {
    expect(await currentAddress({ read: read({ v: 1, mode: "relay", via: "ssh", host: "" }) })).toEqual({ mode: "relay", via: "ssh", origin: null, spki: null });
    expect(await currentAddress({ read: read({ v: 1, mode: "direct", via: "domain", host: "bots.example.com", pin: true }), spki: async () => "k".repeat(43) + "=" }))
      .toEqual({ mode: "direct", via: "domain", origin: "https://bots.example.com", spki: "k".repeat(43) + "=" });
    expect(await currentAddress({ read: read({ v: 1, mode: "direct", via: "cloudflare", host: "old.trycloudflare.com", pin: false, quick: "http://127.0.0.1:20241/quicktunnel" }), quick: async () => "new-one.trycloudflare.com" }))
      .toEqual({ mode: "direct", via: "cloudflare", origin: "https://new-one.trycloudflare.com", spki: null });
  });

  it("says nothing rather than an address without the pin it needs, or one it cannot read", async () => {
    expect(await currentAddress({ read: read({ v: 1, mode: "direct", via: "direct", host: "1-2-3-4.sslip.io", pin: true }), spki: async () => { throw new Error("down"); } })).toBeNull();
    expect(await currentAddress({ read: () => { throw new Error("ENOENT"); } })).toBeNull();
    expect(await currentAddress({ read: read({ v: 1, mode: "direct", via: "domain", host: "bad host", pin: false }) })).toBeNull();
  });
});

describe("what the installer may ask the app to show", () => {
  it("passes sign-in links only on the provider's own host, and records, ports and ssh as plain values", () => {
    expect(installerAsk({ kind: "tailscale-login", url: "https://login.tailscale.com/a/abc123" })).toEqual({ kind: "tailscale-login", url: "https://login.tailscale.com/a/abc123", state: "waiting" });
    expect(installerAsk({ kind: "tailscale-login", url: "https://login.tailscale.com.evil.example/a" })).toBeUndefined();
    expect(installerAsk({ kind: "cloudflare-login", url: "http://dash.cloudflare.com/argotunnel" })).toBeUndefined();
    expect(installerAsk({ kind: "dns", host: "bots.example.com", type: "A", value: "203.0.113.7", state: "found" })).toEqual({ kind: "dns", host: "bots.example.com", type: "A", value: "203.0.113.7", state: "found" });
    expect(installerAsk({ kind: "dns", host: "bots.example.com", type: "TXT", value: "x" })).toBeUndefined();
    expect(installerAsk({ kind: "ssh", user: "ubuntu", host: "203.0.113.7", state: "done" })).toMatchObject({ kind: "ssh", user: "ubuntu" });
    expect(installerAsk({ kind: "ssh", user: "a;rm -rf /", host: "203.0.113.7" })).toBeUndefined();
    expect(installerAsk({ kind: "none" })).toEqual({ kind: "none" });
    expect(installerAsk({ kind: "anything" })).toBeUndefined();
  });
});
