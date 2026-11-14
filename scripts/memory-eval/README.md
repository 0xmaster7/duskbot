# Memory eval

Plays a few weeks of one person's life with two bots against a throwaway dusk bot server running a real
model, then scores what memory kept and what the bots recall later in fresh threads.

```
node --experimental-strip-types scripts/memory-eval/run.ts --label after
node --experimental-strip-types scripts/memory-eval/run.ts --repo /path/to/other/checkout --label before
node --experimental-strip-types scripts/memory-eval/run.ts --rescore scripts/memory-eval/results/after.json --label after
```

- **Sandbox.** `sandbox.ts` starts `server/index.ts` of `--repo` with its own data folder and home, on a free port
  in 7400-7990, with one `openai-compat` engine pointed at the gateway. Nothing of this machine's real bots is
  read or written. Upkeep's capture waits 1 s of quiet instead of two minutes.
- **Gateway.** `DUSK_EVAL_URL` and `DUSK_EVAL_KEY`, else `MCHAT_BASE_URL` and `MCHAT_API_KEY` from
  `~/Desktop/code/mchat/.env` (the local gateway at 127.0.0.1:8317). The key goes only into the sandbox's own
  `config.json` (0600) and is never printed. `--model` picks the bots' model (default `gpt-6.1-terra`),
  `DUSK_EVAL_JUDGE` the judge's.
- **Scenario** (`scenario.ts`). Scout is a personal assistant, Forge works on one project, Atlas. Before week 1 the
  person imports notes from ChatGPT through the checkout's own `aboutMeWithNotes`. Week 1: an introduction
  (name, city, work, short replies), a sister's contact, small talk, Atlas's stack and deploys, a GitHub token,
  one-off tasks, a trivia question, diet and allergy. Week 2: replies should now be detailed, Atlas moved from
  Fly.io to Railway, metric units for every bot (said to Forge), a move from Lisbon to Porto (contradicting the
  import), a one-time code, the sister's new email. Each week ends with what a night runs: each bot's tidy-up
  and, where the build has it, the general memory consolidation.
- **Checks.** Store checks ask a judge yes/no questions about what memory holds as current facts (struck,
  superseded and archived lines are history; source labels are ignored). Probes ask each bot a question in a new
  thread and judge the reply. Every stored line is also judged keep-worthy or junk on its own.
- **Scores.** *recall*: right things remembered and used. *precisionChecks*: nothing stale, contradictory,
  secret, trivial or in the wrong tier. *entryPrecision*: stored lines judged worth keeping. *duplicates*: the
  same fact stored more than once across all tiers. *activeEntries*: lines that load or are recalled.

Time passes only as new threads after a night's upkeep: dates do not advance, so `until` expiry is not tested
here (unit tests cover it). The judge is a model too; `--rescore` re-judges a saved run so two builds can be
compared on the same rubric.

## Results

Run on 2026-11-14 with `gpt-6.1-terra` for the bots and the judge (Claude models were unavailable on the
gateway that day), two runs per build, all four re-judged with the final rubric (`--rescore`).
*Before* is main at `0652e088b`; *after* is the two-tier memory change.

| | before (a) | before (b) | after (a) | after (b) |
| --- | --- | --- | --- | --- |
| recall | 15/15 | 15/15 | 15/15 | 15/15 |
| precision checks | 9/12 | 9/12 | 12/12 | 12/12 |
| stored lines worth keeping | 28/28 | 27/27 | 12/12 | 12/12 |
| the same fact stored twice | 6 | 7 | 0 | 0 |
| lines that load or are recalled | 28 | 27 | 12 | 12 |

Both *before* runs fail the same three checks, all in About me: the old "short replies" and "lives in Lisbon"
stay beside their replacements, so the two contradict. Each bot's own notes were already right (struck through
when replaced), and nothing junk or secret was stored in either build. *After*, a changed fact replaces the old
one in About me at once (the capture step names it), and a fact about the person is stored once instead of in
About me and again in the bot's notes, which is most of the drop from 28 lines to 12.

The scenario is narrow (one person, two bots, two weeks); treat these as a regression check, not a benchmark.
