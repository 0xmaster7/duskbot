import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SCRIPT = fileURLToPath(new URL("../deploy/monitor/uptime-check.sh", import.meta.url));

describe("uptime checks", () => {
  it("mails once after three misses in a row and once on recovery", () => {
    const root = mkdtempSync(join(tmpdir(), "dusk-uptime-")), bin = join(root, "bin");
    mkdirSync(bin);
    // curl stand-in: the check answers with the code in $root/code; a POST to Resend is logged as a mail
    writeFileSync(join(bin, "curl"), `#!/bin/sh\ncase "$*" in *api.resend.com*) echo "$*" >> "${root}/mails";; *) cat "${root}/code";; esac\n`);
    chmodSync(join(bin, "curl"), 0o755);
    const env = { PATH: `${bin}:${process.env.PATH}`, DUSK_UPTIME_STATE: join(root, "state"), DUSK_UPTIME_TARGETS: "site=https://dusk.bot/", DUSK_RESEND_API_KEY: "k", DUSK_ALERT_TO: "ops@example.com" };
    const run = (code: string) => { writeFileSync(join(root, "code"), code); execFileSync("sh", [SCRIPT], { env }); };
    const mails = () => { try { return readFileSync(join(root, "mails"), "utf8").trim().split("\n").filter(Boolean); } catch { return []; } };
    run("200"); run("502"); run("000");
    expect(mails()).toEqual([]);
    run("502"); run("502");
    expect(mails()).toHaveLength(1);
    expect(mails()[0]).toContain("DOWN: site");
    run("200"); run("200");
    expect(mails()).toHaveLength(2);
    expect(mails()[1]).toContain("UP: site");
  });
});
