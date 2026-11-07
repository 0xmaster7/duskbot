import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const run = promisify(execFile);
const script = (await readFile(new URL("../install.sh", import.meta.url), "utf8")).replace(/\nmain "\$@"\s*$/, "\n");

async function provision(scenario) {
  const dir = await mkdtemp(join(tmpdir(), "omb-install-"));
  try {
    const file = join(dir, "fixture.sh");
    await writeFile(file, `${script}
calls=$1
scenario=$2
BOT_DESKTOP_IMAGE=fixture:1
built=0
docker() {
  printf 'docker %s\\n' "$*" >> "$calls"
  case "$*" in
    info|--version) return 0 ;;
    'image inspect fixture:1') [ "$scenario" = cached ] || [ "$built" = 1 ] ;;
    'buildx version') return 1 ;;
    *) return 90 ;;
  esac
}
systemctl() { printf 'systemctl %s\\n' "$*" >> "$calls"; }
apt_install() { printf 'apt_install %s\\n' "$*" >> "$calls"; }
state_set() { printf 'state %s\\n' "$*" >> "$calls"; }
pull_with_progress() { printf 'pull %s\\n' "$*" >> "$calls"; [ "$scenario" = pulled ]; }
get_kit() { printf 'kit\\n' >> "$calls"; KIT=/fixture; [ "$scenario" != no-kit ]; }
build_with_progress() { printf 'build %s\\n' "$*" >> "$calls"; built=1; }
do_docker
code=0
do_desktop || code=$?
printf 'result %s\\n' "$code" >> "$calls"
`);
    const calls = join(dir, "calls");
    await run("sh", [file, calls, scenario], { env: { PATH: "/usr/bin:/bin", TERM: "dumb" } });
    return (await readFile(calls, "utf8")).trim().split("\n");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("desktop installer work", () => {
  it("reuses a cached image without installing build tools or pulling", async () => {
    const calls = await provision("cached");
    expect(calls.filter((line) => /^(apt_install|pull|build|kit)/.test(line))).toEqual([]);
    expect(calls).toContain("state desktop present");
    expect(calls).toContain("result 0");
  });

  it("pulls a published image without installing build tools or building", async () => {
    const calls = await provision("pulled");
    expect(calls.filter((line) => /^(apt_install|build|kit)/.test(line))).toEqual([]);
    expect(calls.filter((line) => line.startsWith("pull "))).toEqual(["pull fixture:1"]);
    expect(calls).toContain("state desktop pulled");
    expect(calls).toContain("result 0");
  });

  it("installs build tools once only when a local build is required", async () => {
    const calls = await provision("build");
    expect(calls.filter((line) => line.startsWith("apt_install "))).toEqual(["apt_install docker-buildx"]);
    expect(calls.filter((line) => line.startsWith("build "))).toEqual(["build fixture:1 /fixture/deploy/bot-desktop"]);
    expect(calls).toContain("state desktop built");
    expect(calls).toContain("result 0");
  });

  it("does not install build tools when the desktop kit is unavailable", async () => {
    const calls = await provision("no-kit");
    expect(calls.filter((line) => /^(apt_install|build)/.test(line))).toEqual([]);
    expect(calls).toContain("result 11");
  });
});
