# Hosts: one managed home, any provider

A managed home (My Cloud) can run on more than one provider. Each provider is a **host**: the adapter for its API
(`MachineProvider`, `src/provider.ts`), what runs on its machines (`MachineImage`), its prices and start rules
(`ProviderCostProfile`, `src/power/cost.ts`) and its own settings. Everything above the host, the lifecycle, the power
policy and its rails, the monthly cost ceiling, backups, retention and the edge, is shared and unchanged. This file is
the design; the provider notes for Boat are in `provider.md`, the home's data in `home-data.md`, the policy in `power.md`.

Hosts today: `boat` (the default, unchanged) and `instabox` (behind configuration, off unless enabled). The app, the home
and the public docs still never name either (`scripts/provider-names.ts` bans both words in what ships).

## 1. The host interface

`MachineProvider` already covers create, read, list, power, run a command, upload a file, a dead-man lease, snapshots for
backups, named snapshots (templates) and deletion with a receipt. A host adds what its provider can do beyond Boat's model,
as optional capabilities, so the lifecycle branches on a capability and never on a name:

| Capability | Meaning | boat | instabox |
| --- | --- | --- | --- |
| `memoryPause` | "off" keeps memory and processes; "on" continues where it left off | no (a stop saves the disk) | yes (suspend/resume) |
| `liveBackup` | a consistent backup can be read from a running machine | no (from the stop's snapshot) | yes (`omb-home snapshot`) |
| `usage(serverId)` | the provider's own running seconds, disk and egress for one machine | no | yes (`/v1/machines/{id}/usage`) |

| Operation | boat | instabox |
| --- | --- | --- |
| create | `POST /sandboxes`, setup script and boot file in the body, idempotency key per cloud and attempt | `POST /v1/machines` named `omb-<cloud>-<attempt>` (the name is the idempotency), then the boot file is uploaded and the setup script started in the background; `vault: false`, no Secrets (our `noEnv`) |
| status | sandbox state, setup status | machine state; setup status from the `omb.setup` label, then the setup's status file |
| on | `resume` an archived sandbox | `resume` a suspended machine (memory kept), `start` a stopped one |
| off | `stop` (pre-stop hook stops the home first, disk saved) | `sync`, then `suspend` (memory kept, nothing stopped) |
| desktop stream | hosted port 8080 | published port 8080 |
| lease | `ttlSeconds` auto-stop | an activity lease (30 s to 1 h), plus the machine's own idle pause (30 min) once the lease lapses |
| backup | newest stop snapshot, read as a tar | `omb-home snapshot`: online SQLite copies plus the rest of the volume, downloaded |
| restore | renames `/data` | in place: `/data` is the platform's mount (it also holds the machine user's home), only our entries are swapped |
| delete | `DELETE` with `X-Ascii-Confirm-Delete` and an operation receipt | `DELETE` with `X-Confirm-Delete` and an operation receipt |
| purge of stopped disks | after 14 days (keep-alive starts) | never (keep-alive off) |

Machine state maps onto the lifecycle's five words. A suspended InstaBox machine is `stopped` to the lifecycle (asleep),
`suspending` and `resuming` are `stopping` and `starting`.

## 2. Which host a cloud runs on

- `managed.host` on the cloud's record names its host. **Absent means `boat`**, forever: every existing record keeps
  running where it runs, whatever the default becomes.
- `DUSK_MANAGED_HOSTS` (default `boat`) lists the hosts this service can drive; `DUSK_MANAGED_HOST` (default `boat`) is
  where a new cloud is made. A Boat-only deployment writes exactly the records and files it wrote before.
- One lifecycle per host, sharing the backup store, the audit, the policy code and the clouds. Each host keeps its own
  start ledger and spend book (`provider-starts.json` and `spend/` stay Boat's; InstaBox's are `instabox-starts.json`
  and `spend-instabox/`) and its own stray-machine sweep, which sees only that host's machines.
- InstaBox settings: `INSTABOX_API_KEY` (runtime key, account service only), `INSTABOX_BASE_URL` (default
  `https://api.instabox.sh`), `DUSK_MANAGED_INSTABOX_TEMPLATE` (default `universal`: Docker, no desktop of its own; our bot
  computers bring theirs), `DUSK_MANAGED_INSTABOX_IDLE_PAUSE_MINUTES` (default 30, the dead-man pause).

## 3. Lifecycle on a memory-keeping host

The lifecycle is the same code for both hosts. What changes is priced, not branched:

- **Sleep** is the same decision (the policy compares the compute saved with the next wake's cost) and the same
  handshake with the home. On InstaBox the home's processes are frozen, not stopped: no pre-stop, the databases stay
  open, a resume continues the turn queue, the bot computers and their browsers where they were. The home already
  notices a resume by the clock jump (`server/cloud-power.ts`) and its due timers re-check the wall clock every minute
  (`server/due-timer.ts`), so a routine due during the pause runs within a minute of the resume.
- **Wake** runs `omb-home start` as always; on InstaBox it is a no-op when the home is up, answering and already has its
  origin, so a resume does not restart anything. A resume the provider could only do as a cold boot
  (`processesPreserved: false`) finds the home down, and the same command starts it.
- **Cost model** (`instaboxCostProfile`): compute by size (2/4 1.7 c/h, 4/8 3.4 c/h, 8/16 6.8 c/h); starts cost nothing
  and are limited to 30 a minute per workspace; a resume is "held" (memory kept, a few seconds) with probability 0.95 and
  no time window, else a cold boot. With the tuned shadow prices a stop is worth it after about 10 to 15 idle minutes.
- **Never pause mid-task, never wake on app open, loop guard, budgets, breaker, wake batching, the monthly ceiling**:
  the existing rails, unchanged (`power.md`). The wake lead before a routine is 2 minutes on InstaBox (4 on Boat).
- **Backups**: before an idle sleep, when one is due (`DUSK_MANAGED_BACKUP_HOURS`), the lifecycle takes a live backup
  first, then sleeps the home; a home that never sleeps still gets the awake-overdue backup. Same encrypted store, same
  generations, same verification.
- **Dead-man**: while the service runs, an activity lease (renewed with the lease) keeps InstaBox's own idle pause off; if
  the service stops, the lease lapses and the machine pauses itself after 30 idle minutes. A machine that paused itself
  is asleep to the lifecycle and woken like any other on intent.
- **Recovery**: a machine reported missing (repeated 404s and absent from the list) is rebuilt from the newest verified
  backup, as on Boat. A cold-booted machine is not lost: its home is started again.

## 4. The portable state: what moves and how

The unit of a managed home's state is its `/data` volume (`home-data.md`): identity, chats, memory, routines, files,
skills, connected-app credentials, engine sign-ins and the agent browser's profiles. It is host-neutral by construction:
the same layout on Boat and InstaBox, and the same server as This Mac and a VPS.

**The home bundle** (`src/bundle.ts`, `scripts/home-bundle.ts`) describes a volume: a versioned manifest
(`{ format: "dusk-home-bundle", v: 1, cloudId, createdAt, source, files: [{ path, bytes, sha256, layer }], layers }`)
next to the volume tar, sealed with AES-256-GCM like every backup (a per-cloud key inside the service; a passphrase,
scrypt-derived, for a bundle that leaves it). Layers, from `home-data.md`:

| Layer | Moves | Notes |
| --- | --- | --- |
| identity, chats, memory, routines, files, skills, config | yes | bit for bit |
| credentials (sessions, connected apps, engine sign-ins) | yes, inside the sealed bundle only | never in a manifest; routines arrive as they were |
| agent browser profiles (`agent-browser-profiles/`, `browser-engine-key`) | yes | signed-in sites stay signed in where the site allows a new IP |
| disposable (`tmp`, caches, `.backups`) | no | rebuilt |
| machine identity (`dashboard-link.json`, `cloud-entitlement`, `CLOUD_HOME.etc`) | no | issued again by the claim |
| bot computers' Docker volumes (desktop containers, their Chromium) | no | on the machine's root disk, outside `/data`; a moved home's computers start fresh |

**Flows.**

- **This Mac or a VPS to a cloud (exposed to people):** the app's existing move (`electron/one-home.mjs`, `cloud-send`,
  freeze after move, rollback by lifting the freeze). It talks only to the home's HTTP API, so it is the same on every
  host. Nothing new is exposed.
- **Cloud to cloud (operator, internal):** `ManagedCloud.migrate(cloud, host)` (below), for moving a test user, a fleet or
  a person between providers.
- **Cloud to This Mac or a VPS (internal for now):** the existing move back (`one-home-again.mjs`: the home boots
  export-only, `workspace-backup` export, restore locally). Not offered to people yet.

## 5. Cloud-to-cloud migration (`src/migrate.ts`)

An operator step machine on the cloud's record (`managed.migration`), run by the reconciler, every step safe to repeat:

1. **backup**: the source home is put to sleep through the normal handshake (never mid-task); a fresh verified backup is
   taken (from the stop's snapshot on Boat, live on InstaBox) and its manifest kept.
2. **copy**: the record switches host; the source machine is kept as it is (stopped or paused, never deleted) in the
   migration record, not in `retired`; a new machine on the target is created, set up and restored from that backup
   through the normal provisioning path (a new attempt, a new one-time claim, the same cloud id and keys).
3. **validate**: once the home answers, the manifest's files are checked on the target (`sha256sum -c` against the
   volume), the home's health, and the agent browser profiles' presence. Any mismatch fails the step: the cloud rolls
   back by itself.
4. **cut over**: the edge's label points at the new upstream as soon as the cloud runs there (the person's address never
   changes). The source machine stays asleep for rollback.
5. **finish** (operator, later): the source machine is deleted through its own host. Irreversible, so never automatic.

**Rollback** (any time before finish): the target home is put to sleep; if it ran since the cutover, its state is backed
up and kept (`keep: true`, never pruned) and the operator is told, so nothing is lost silently; the record switches back
to the source host and machine and wakes it. Downtime of a migration is the sleep, the restore and one start.

## 6. What a migration cannot carry, and why

- **Bot computers' desktops** (their Docker volumes) live on each machine's root disk; they are rebuilt empty on the new
  machine. The agent browser's profiles (in `/data`) do move.
- **Processes and memory**: a migration is a cold start on the target. Only InstaBox's own pause keeps them, and only on
  the same machine.
- **IP-bound sessions**: a site that ties a sign-in to an address may ask again from the new provider's addresses.

## 7. Testing

- `src/instabox.test.ts` (fake API), `src/hosts.test.ts` (routing, Boat untouched), `src/migrate.test.ts` (both
  directions, validation failure, rollback), `src/bundle.test.ts`, `src/home.test.ts` (the Boat scripts byte for byte).
- `scripts/lifecycle-sim.ts --host instabox`: the personas and fleets on InstaBox's prices, pause/resume loops, routines
  and recovery under faults.
- `scripts/instabox-live.ts`: the real run on InstaBox (a test scope, a test user, every machine deleted at the end).
