# Live Vercel rig

The rig drives one real cloud thread on real Vercel through the rebuilt lifecycle: birth, idle park, wake-on-send, `/wake`, and a version-mismatch swap. At every step it records the sandbox's lifecycle record, its version and protocol stamps, the serve log, and the client's connection view, and it writes one evidence file per scenario.

This is a script. It is not production code, and it never runs in CI.

## Run

From `apps/tui` in a checkout where `bun install` has been run:

```sh
cd apps/tui && ATLAS_LIVE_RIG=1 NODE_ENV=development bun scripts/cloud-bench/live-rig.tsx --scenarios=1,2,3
```

Without `ATLAS_LIVE_RIG=1`, the script prints its usage and exits 0 without touching anything.

| Arg                                   | Default                                  | Meaning                                                                                                                                          |
| ------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `--scenarios=1,2,3`                   | `1,2,3,4,5`                              | Which scenarios to run. Asking for any of 2–5 adds 1, because they all run on the thread that 1 births. Scenario 6 is always written as NOT RUN. |
| `--out=<dir>`                         | `$ATLAS_CONTEXT_DIR/evidence/live-rig`   | Where evidence goes. Required when `ATLAS_CONTEXT_DIR` is unset.                                                                                 |
| `--repo=<https url>`                  | `https://github.com/octocat/Hello-World` | The workspace that gets cloned. It must be https, because the sandbox clones it too.                                                             |
| `--mismatch=source-edit\|forge-stamp` | `source-edit`                            | How scenario 5 forces the version mismatch.                                                                                                      |
| `--keep`                              | off                                      | Leave the sandboxes running at the end.                                                                                                          |
| `--cleanup`                           | off                                      | Destroy every sandbox named in `<out>/ledger.json`, then exit.                                                                                   |

The exit code is 0 when every verdict is PASS or NOT RUN. It is 1 for any FAIL or UNTRUSTED, 2 for bad arguments, and 130 after SIGINT or SIGTERM.

## Scenarios

The scenarios run in ascending id order on one thread. If scenario 1 does not pass, scenarios 2–5 are written as NOT RUN with the reason "depends on scenario 1". Otherwise 2–5 do not depend on one another, with one exception: when scenario 2 fails, scenario 3 waits up to 8 minutes for a park itself before it sends.

| Id  | File                        | Evidence                                                                                                 |
| --- | --------------------------- | -------------------------------------------------------------------------------------------------------- |
| 1   | `rig-scenario-fresh.ts`     | `scenario-1-fresh.md`                                                                                    |
| 2   | `rig-scenario-park.ts`      | `scenario-2-idle-park.md`                                                                                |
| 3   | `rig-scenario-wake-send.ts` | `scenario-3-wake-on-send.md`                                                                             |
| 4   | `rig-scenario-wake-cmd.ts`  | `scenario-4-wake-command.md`                                                                             |
| 5   | `rig-scenario-swap.ts`      | `scenario-5-version-swap.md`                                                                             |
| 6   | `rig-scenario-api-wake.ts`  | `scenario-6-api-wake.md` (always NOT RUN: the only trigger is a real GitHub webhook or the poll sweeper) |

`rig-scenarios.ts` holds the ordered registry.

## Evidence layout

```text
<out>/
  ledger.json                 sandbox names the rig created, appended before each provisions
  scenario-<id>-<slug>.md     one per scenario, written the moment that scenario finishes
  run-summary.md              verdict table, trust gate, sandboxes created and destroyed
```

Each scenario file holds, in order: the verdict, the reason, the failing step with expected vs observed (on FAIL), the commands, a timestamped observation table, and the log excerpts. When a scenario FAILs, the runner appends the last 80 serve-log lines (only if the box is running) and the last 40 driver lines.

Evidence from scenarios 2–5 that throw `EvidencedScenarioFailed` keeps its own observations and logs, and the runner appends those tails to it.

## Trust gate

When scenario 1 ends, the runner reads two things:
- the box stamps: `/opt/atlas/atlas-serve.version` and `.protocol`
- the channel Ready protocol: a raw Hello on a second websocket to `${url}/v1/session`, using the url and token from `channel.attachment()`

It runs `trustOf` on each of them. Both must be trusted: the version must start with `dev-` and the protocol must be 25. If either one fails, every PASS or FAIL verdict is downgraded to UNTRUSTED, and the underlying verdict is kept in the reason. NOT RUN stays NOT RUN.

## Ledger ordering

The ledger is written before provisioning. Here is the exact sequence:
1. `mountRig` flips the placement chip to `☁ cloud`.
2. The flip runs the birth, which calls the bridge's `sandboxes.create`.
3. rig-mount's `create` wrapper awaits `onBirth(threadId)` before it calls the inner create.
4. The runner passes `onBirth` on every mount and remount, so that hook runs `ledger.add({ name: sandboxNameFor({ threadId }), threadId })`.

So a name lands in `ledger.json` before any Vercel call can create the sandbox. A name already in the ledger is not added twice.

## Safety rules

- The rig destroys only names that appear in `<out>/ledger.json`. `probes.destroy` refuses anything else, and the rig logs each name as it destroys it.
- Unless you pass `--keep`, the rig destroys the ledger names at the end. It also does so on SIGINT or SIGTERM: the signal handler marks the in-flight scenario FAIL ("interrupted"), writes `run-summary.md`, destroys the ledger sandboxes, and then calls `process.exit`. The headless renderer would otherwise keep the process alive.
- If a run dies before cleanup, run `--cleanup` with the same `--out`.
- Probes never `runCommand` a sandbox whose status is not `running`, because `@vercel/sandbox` would auto-resume a parked box.
- Every console line and every evidence file passes through the redactor. The redactor holds the Vercel token from startup and the serve token as soon as a channel is attached. It always strips `team_…`, `prj_…` and `bearer.…`.
- The home is a throwaway `ATLAS_HOME`, seeded from `~/.atlas` (`cloud.json`, `key`, `secrets.json`, `settings.json`, `auth.json`). The workspace is a throwaway clone. The rig removes both on exit.
- In `source-edit` mode, scenario 5 appends one line to `apps/serve/src/main.ts`. It refuses if that file is dirty, and it restores the original bytes in a `finally` and on SIGINT or SIGTERM.

## Offline checks

```sh
bun test apps/tui/scripts/cloud-bench/__tests__
cd apps/tui && bunx tsc --noEmit -p .
```
