// the nat lab's network: linux network namespaces joined by veth pairs, nat and firewalls in nftables, impairments with
// tc netem. everything here is real kernel networking on one linux box; only the "internet" is a bridge (198.51.100.0/24,
// 2001:db8:100::/64) with a nat of its own to the box's real uplink, so cloudflare and dns work from inside. run as root.
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";

const sh = (cmd, { quiet = false } = {}) => {
  try { return execFileSync("sh", ["-c", cmd], { stdio: quiet ? "ignore" : ["ignore", "pipe", "pipe"] })?.toString() ?? ""; }
  catch (error) { if (quiet) return ""; throw new Error(`${cmd}\n${error.stderr?.toString() ?? error.message}`); }
};
export const inNs = (ns, cmd, options) => sh(`ip netns exec ${ns} sh -c '${cmd.replace(/'/g, "'\\''")}'`, options);
const NSES = ["wan", "relay", "stun", "srv", "srvr", "cli", "clir", "clir2", "cgn"];

export function teardown() {
  for (const ns of NSES) sh(`ip netns del ${ns}`, { quiet: true });
  sh("ip link del vroot", { quiet: true });
  sh("nft delete table ip natlab", { quiet: true });
  rmSync("/etc/netns", { recursive: true, force: true });
}

function ns(name) {
  sh(`ip netns add ${name}`);
  inNs(name, "ip link set lo up; sysctl -qw net.ipv4.ip_forward=1 net.ipv6.conf.all.forwarding=1 net.ipv4.conf.all.rp_filter=0 net.ipv4.conf.default.rp_filter=0");
  mkdirSync(`/etc/netns/${name}`, { recursive: true });
  writeFileSync(`/etc/netns/${name}/resolv.conf`, "nameserver 1.1.1.1\nnameserver 8.8.8.8\n");
}
let pairs = 0;
/** a veth pair between two namespaces, addressed */
function link(a, aIf, aAddrs, b, bIf, bAddrs, { mtu = 1500 } = {}) {
  const tag = Math.random().toString(36).slice(2, 7), tmpA = `t${tag}a`, tmpB = `t${tag}b`;
  pairs += 1;
  sh(`ip link add ${tmpA} type veth peer name ${tmpB}`);
  sh(`ip link set ${tmpA} netns ${a}; ip link set ${tmpB} netns ${b}`);
  inNs(a, `ip link set ${tmpA} name ${aIf} mtu ${mtu} up`);
  inNs(b, `ip link set ${tmpB} name ${bIf} mtu ${mtu} up`);
  for (const addr of aAddrs) inNs(a, `ip addr add ${addr} dev ${aIf} nodad 2>/dev/null || ip addr add ${addr} dev ${aIf}`);
  for (const addr of bAddrs) inNs(b, `ip addr add ${addr} dev ${bIf} nodad 2>/dev/null || ip addr add ${addr} dev ${bIf}`);
}
/** a host on the internet bridge */
function onWan(name, v4, v6) {
  link("wan", `w-${name}`.slice(0, 15), [], name, "wan0", [`${v4}/24`, ...(v6 ? [`${v6}/64`] : [])]);
  inNs("wan", `ip link set w-${name}`.slice(0) + ` master br0`);
  inNs(name, `ip route add default via 198.51.100.1`);
  if (v6) inNs(name, `ip -6 route add default via 2001:db8:100::1`, { quiet: true });
}

/**
 * kinds of nat a router does (nftables): "full" (endpoint independent mapping and filtering: everything inbound to a
 * port goes to the one host behind), "restricted" (linux's own: the port kept, inbound only from where it went),
 * "symmetric" (a new random port per destination)
 */
function nat(router, out, kind, inside) {
  const masq = kind === "symmetric" ? "masquerade random,fully-random" : "masquerade";
  const rules = [`table ip nat {`, `  chain post {`, `    type nat hook postrouting priority 100;`, `    oifname "${out}" ${masq};`, `  }`];
  if (kind === "full") rules.push(`  chain pre {`, `    type nat hook prerouting priority -100;`, `    iifname "${out}" udp dport 1024-65535 dnat to ${inside};`, `  }`);
  rules.push(`}`);
  inNs(router, `nft -f - <<'EOF'\n${rules.join("\n")}\nEOF`);
}

/**
 * builds one scenario's network. `client`: { nat, cgnat, firewall: null | "udp" | "tcp443" | "proxy", v6only, netem,
 * mtu }, `server`: { nat: null | kind, firewall: "vps" | null }. answers the addresses the processes need
 */
export function build({ client = {}, server = {} } = {}) {
  teardown();
  pairs = 0;
  ns("wan");
  inNs("wan", "ip link add br0 type bridge; ip link set br0 up; ip addr add 198.51.100.1/24 dev br0; ip addr add 2001:db8:100::1/64 dev br0 nodad");
  // the internet's own way out to the real one (cloudflare, dns), through the box
  sh("ip link add vroot type veth peer name vwan; ip link set vwan netns wan; ip addr add 10.250.0.1/30 dev vroot; ip link set vroot up");
  inNs("wan", "ip addr add 10.250.0.2/30 dev vwan; ip link set vwan up; ip route add default via 10.250.0.1");
  sh("sysctl -qw net.ipv4.ip_forward=1");
  // a box with docker drops forwarded packets by default; the lab's own are let through
  for (const chain of ["DOCKER-USER", "FORWARD"]) { sh(`iptables -C ${chain} -i vroot -j ACCEPT 2>/dev/null || iptables -I ${chain} -i vroot -j ACCEPT`, { quiet: true }); sh(`iptables -C ${chain} -o vroot -j ACCEPT 2>/dev/null || iptables -I ${chain} -o vroot -j ACCEPT`, { quiet: true }); }
  const uplink = sh("ip route show default | awk '{print $5; exit}'").trim();
  sh(`nft -f - <<'EOF'\ntable ip natlab {\n  chain post {\n    type nat hook postrouting priority 100;\n    ip saddr { 10.250.0.0/30, 198.51.100.0/24 } oifname "${uplink}" masquerade;\n  }\n}\nEOF`);
  inNs("wan", `nft -f - <<'EOF'\ntable ip nat {\n  chain post {\n    type nat hook postrouting priority 100;\n    oifname "vwan" masquerade;\n  }\n}\nEOF`);

  ns("relay"); onWan("relay", "198.51.100.10", "2001:db8:100::10");
  ns("stun"); onWan("stun", "198.51.100.20", "2001:db8:100::20");

  // the server: public (a vps), or behind a router of its own
  ns("srv");
  let serverAddress;
  if (!server.nat) { onWan("srv", "198.51.100.30", "2001:db8:100::30"); serverAddress = "198.51.100.30"; }
  else {
    ns("srvr"); onWan("srvr", "198.51.100.31");
    link("srvr", "lan0", ["10.20.0.1/24"], "srv", "eth0", ["10.20.0.2/24"]);
    inNs("srv", "ip route add default via 10.20.0.1");
    nat("srvr", "wan0", server.nat, "10.20.0.2");
    serverAddress = "198.51.100.31";
  }
  // a vps that drops unsolicited udp (oracle's security list, most hosts' firewalls); ssh stays open
  if (server.firewall === "vps") inNs("srv", `nft -f - <<'EOF'\ntable inet fw {\n  chain in {\n    type filter hook input priority 0; policy accept;\n    ct state established,related accept;\n    iifname "lo" accept;\n    udp dport 1-65535 ct state new drop;\n  }\n}\nEOF`);

  // the client: behind its router, maybe behind a carrier's nat too
  ns("cli"); ns("clir");
  const v6only = client.v6only === true;
  if (client.cgnat) {
    ns("cgn"); onWan("cgn", "198.51.100.41");
    link("cgn", "lan0", ["100.64.0.1/24"], "clir", "wan0", ["100.64.0.2/24"]);
    inNs("clir", "ip route add default via 100.64.0.1");
    nat("cgn", "wan0", client.cgnat, "100.64.0.2");
  } else onWan("clir", "198.51.100.40", "2001:db8:100::40");
  link("clir", "lan0", v6only ? ["2001:db8:50::1/64"] : ["192.168.50.1/24", "2001:db8:50::1/64"], "cli", "eth0", v6only ? ["2001:db8:50::2/64"] : ["192.168.50.2/24", "2001:db8:50::2/64"], { mtu: client.mtu ?? 1500 });
  if (!v6only) inNs("cli", "ip route add default via 192.168.50.1");
  inNs("cli", "ip -6 route add default via 2001:db8:50::1", { quiet: true });
  if (!client.cgnat) inNs("wan", "ip -6 route add 2001:db8:50::/64 via 2001:db8:100::40", { quiet: true });
  if (!v6only) nat("clir", "wan0", client.nat ?? "restricted", "192.168.50.2");
  if (v6only) writeFileSync("/etc/netns/cli/resolv.conf", "nameserver 2606:4700:4700::1111\n");
  // a path mtu black hole: a small link on the way and the "fragmentation needed" answers dropped
  if (client.mtu) inNs("clir", `nft -f - <<'EOF'\ntable inet pmtu {\n  chain filt {\n    type filter hook forward priority 0;\n    icmp type destination-unreachable drop;\n    icmpv6 type packet-too-big drop;\n  }\n}\nEOF`);
  const firewall = client.firewall;
  if (firewall) {
    const allow = firewall === "udp" ? "meta l4proto tcp accept; udp dport 53 accept;"
      : firewall === "tcp443" ? "tcp dport 443 accept; udp dport 53 accept; tcp dport 53 accept;"
        : "";
    inNs("clir", `nft -f - <<'EOF'\ntable inet fw {\n  chain filt {\n    type filter hook forward priority 0; policy drop;\n    ct state established,related accept;\n    iifname "wan0" ct state new drop;\n    ${allow}\n  }\n}\nEOF`);
  }
  // loss in nftables (the lab box's kernel has no netem, so no added delay): `client.loss` percent of forwarded packets
  if (client.loss) inNs("clir", `nft -f - <<'EOF'\ntable inet loss {\n  chain filt {\n    type filter hook forward priority -10;\n    numgen random mod 100 < ${client.loss} drop;\n  }\n}\nEOF`);
  return { relay: "198.51.100.10", relay6: "2001:db8:100::10", stun: "198.51.100.20", server: serverAddress, proxy: "192.168.50.1" };
}

/** the client moves to another network (a phone leaving wifi): a second router, a new address, the old route gone */
export function roam({ nat: kind = "restricted" } = {}) {
  ns("clir2"); onWan("clir2", "198.51.100.42");
  link("clir2", "lan0", ["192.168.60.1/24"], "cli", "eth1", ["192.168.60.2/24"]);
  nat("clir2", "wan0", kind, "192.168.60.2");
  inNs("cli", "ip route replace default via 192.168.60.1; ip addr flush dev eth0; ip link set eth0 down");
}

/** a captive portal on the client's router: every https and http connection lands on `portal` until `release()` */
export function captive(portal) {
  inNs("clir", `nft -f - <<'EOF'\ntable ip captive {\n  chain pre {\n    type nat hook prerouting priority -101;\n    iifname "lan0" tcp dport { 80, 443 } dnat to ${portal};\n  }\n}\nEOF`);
  return { release: () => inNs("clir", "nft delete table ip captive", { quiet: true }) };
}

export { sh };
