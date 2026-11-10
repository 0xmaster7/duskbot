# The power policy: when a home stops and starts

The code is `src/power/`. Nothing in it names a provider: a provider describes itself as a `ProviderCostProfile`
(`cost.ts`), built by its adapter (`boatCostProfile` in `src/boat.ts`).

## The cost model (`cost.ts`)

- **Compute:** cents per hour of a machine of a given size, billed per second while it runs.
- **Starts:** the account's start pool in rolling minute, hour and day windows (no reset at midnight), the price of one
  more start given how full each window is (the highest tier of the three), and the hard cap past which the provider
  refuses one.
- **The kept machine:** a resume within its window after a stop usually gets the same machine back and is no start.
- **Wake time:** how long a person waits for a cold wake and for a held one.
- **Shadow prices** for what cash does not show: an included start still spends the shared pool (its value rises to
  the first paid price as the day and hour windows fill past half), every start can fail or hydrate slowly (a risk
  premium), and a person or a connector event waiting through a cold wake is a cost.

## The decision (`policy.ts`, `decide(snapshot)`)

For an awake home the policy compares stopping now with "stay up for tau, then stop" for every tau on a grid out to a
day, and with "stay up until the next run". Each option's expected cost is the compute while awake plus, at the next
need, a start (cheaper inside the kept-machine window) and a wait (none for a run: it is pre-woken). The next need is
the earlier of the owner's next event (the predictor) and the next run (the schedule). A stop happens only when it is
the cheapest option. The answer carries both costs and the reason (`cheaper_asleep`, `likely_back_soon`,
`run_soon_cheaper_awake`, a rail's name), kept as the cloud's `stayReason` for the operator.

What this does in practice:

- A home whose routines run every 15 to 30 minutes stays up around the clock: each start would cost more than the
  compute between runs. Hourly or two-hourly routines stay up once starts are paid, and sleep between runs while the
  pool is far from full.
- A person in a session keeps the home up through the gaps their own history says they come back from; once the
  session is over (no event for 90 minutes) only their usual hours count.
- Paid starts, a filling pool and a provider near its hard cap all push toward staying up; free starts and long
  predicted gaps toward sleeping.

## The predictor (`predictor.ts`)

Per home, from its own events (sends, clicks, connector events), with counts that halve every half-life:

- **Within a session:** a histogram of the gaps between events (1 to 90 minutes) and how often a session ended.
- **New sessions:** how often one began in each UTC hour, weekdays and weekends apart (weekends lean on weekdays until
  there is evidence).
- **A new home** starts from a flat prior (three sessions a day, spread over the day).

Cheap (a few arrays on the cloud's record), deterministic, and robust to duplicates and out-of-order events.

## Routines (`schedule.ts`)

- A run keeps its exact time unless its routine allows a window (`flexMs`, reported by the home in `upcoming`); a
  flexible run can share a wake the owner already caused. Today's homes report only `nextDueAt` (exact).
- A sleeping home wakes a lead before its run (the cold wake time plus a margin). An optional per-home spread exists
  (`spreadMs`); the tuned default is 0, because the planner below already spreads a crowded minute.
- **Wake batching:** one planner per service gives each pre-wake a minute, at most half the minute window's included
  starts to a minute, moving a crowded one up to 30 minutes earlier. A burst of runs at the same hour never fills the
  minute window.

## The rails (`rails.ts`): hard limits nothing bypasses

The lifecycle checks them itself before every provider start (`start()` in `lifecycle.ts`) and before acting on any
stop, whatever the policy said.

- **Never stop work:** a turn, a run, a call, a computer, maintenance (uploads, backups, installs), work that just
  ended, a wake just asked for (its delivery), a run about to start, an unknown busy code. A stop happens only after the
  home agreed in the sleep handshake and its pre-stop hook ran.
- **Minimum uptime** after a start, and a **minimum idle** after a person's last action.
- **No flapping:** each stop that a start followed within 10 minutes doubles the minimum idle (up to 2 hours) for a day.
- **Per-home start budgets** per rolling hour and day. They are kept by refusing stops, never by refusing a person: a
  home that spent its budget stays up until a start ages out.
- **Restart-loop breaker:** three failed starts in 30 minutes open it; automatic starts wait (5 minutes, doubling to 2
  hours), a person may still try once per quarter of the backoff, no stop while it is open, and the operator is alerted
  (`starts_failing`).
- **The pool:** no start past the provider's hard cap in any window or before its `nextStartAt` (from a 429); no stop
  while the next start might be refused; a pre-wake that can wait is held out of a minute that would turn paid.
- **Safety net:** the provider's own auto-stop (the lease, extended only while the service runs), so a lost record
  cannot run forever.
- **Wake on intent only:** a send, a click, typing, a connector event or a routine; never opening or viewing.

## The ledger (`src/starts.ts`)

Every start in rolling windows (`provider-starts.json`, v2), a day-by-day summary for the next-plan decision, the
operator's alerts as the rolling day passes 70%, 100%, 150%, 200% and 500% of the included starts, and the provider's
"not before" time after a refusal.

## Configuration

- `DUSK_MANAGED_PROVIDER_PLAN` (`trial`, `20`, `100`, `500`, `2000`; default `20`): the start pool the policy prices.
  `DUSK_MANAGED_DAILY_STARTS` scales it (seats, a custom plan).
- `DUSK_MANAGED_IDLE_MINUTES` (default 3): the rails' minimum idle.
- `DUSK_MANAGED_WAKE_LEAD_MINUTES` (default 4): how long before a run its home wakes.

## The cost study

`scripts/lifecycle-sim.ts` simulates fleets on the provider's real prices (personas, mixed fleets by plan tier, faults),
tunes the policy's settings by coordinate descent and writes the report. It drives this exact `decide()`/`wake()` and
rails. The fuzz tests (`src/power/fuzz.test.ts`) use the same simulator.
