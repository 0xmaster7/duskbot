// a vpn that drops full-size packets (measured: a wireguard utun saying mtu 1420 that passes about 1344 bytes) stalls
// every segment this computer sends at the interface's mss until the kernel gives up on them. node has no setsockopt, so
// a one-shot perl (in every macos) clamps TCP_MAXSEG on the connected socket it inherits as fd 3. it only lowers what
// this end sends: xnu builds the syn's mss option from the route alone, so what the far end sends stays as it is.
import { spawn } from "node:child_process";

export const SAFE_MSS = 1200;
const PERL = "/usr/bin/perl";
const SCRIPT = "use Socket qw(IPPROTO_TCP TCP_MAXSEG); open(my $s, '+<&=', 3) or exit 2; setsockopt($s, IPPROTO_TCP, TCP_MAXSEG, pack('i', $ARGV[0])) or exit 3; if ($ARGV[1]) { print unpack('i', getsockopt($s, IPPROTO_TCP, TCP_MAXSEG)) }";

/**
 * clamps a connected tcp socket's send mss; resolves the clamped value when `readBack`, true when it ran, false when it
 * could not (not macos, no perl, a socket without its own fd). never throws: the socket works the same unclamped.
 */
export function clampMss(socket, { mss = SAFE_MSS, platform = process.platform, spawnImpl = spawn, readBack = false } = {}) {
  if (platform !== "darwin" || !socket || socket.destroyed || typeof socket._handle?.fd !== "number" || socket._handle.fd < 0) return Promise.resolve(false);
  return new Promise((resolve) => {
    let child, out = "";
    // the bare fd: a stream here would get a socket of its own in this process, which reads what the server sends
    try { child = spawnImpl(PERL, ["-e", SCRIPT, String(mss), readBack ? "1" : ""], { stdio: ["ignore", readBack ? "pipe" : "ignore", "ignore", socket._handle.fd] }); }
    catch { resolve(false); return; }
    child.stdout?.on("data", (chunk) => { out += chunk; });
    child.once("error", () => resolve(false));
    child.once("close", (code) => resolve(code !== 0 ? false : readBack ? Number(out) : true));
  });
}
