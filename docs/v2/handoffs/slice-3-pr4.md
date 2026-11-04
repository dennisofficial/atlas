# Handoff: Atlas v2 slice 3, PR 4 (live exit tests, fault matrix, docs)

Written 2026-11-04 by the session that finished slice 3 PR 3. Read with the spec
[`../slices/03-agent-host.md`](../slices/03-agent-host.md) (exit tests, fault matrix, "Delivery" step 4) and
[`slice-3-pr3/`](slice-3-pr3/) (README, decisions.md).

## Where things stand (all on main)

| PR    | What                                                                                                                                                                                                                            |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #1787 | Routes open to every user; `v2` prefix dropped from names (`sessions.*`, `agentHost.*`, `AGENT_HOST_TOKEN`, `DAEMON_SECRET`, `atlas:session-wake`, task `reconcile-holders`).                                                   |
| #1793 | `apps/agent-host` skeleton; `VercelSandboxProvider` + `launchDaemon` (bundle version = sha256 of content); per-sandbox `DAEMON_TOKEN` (the daemon never sees `DAEMON_SECRET`); `agentHost.config` returns the model credential. |
| #1796 | `SessionHolder` in `packages/host/src/holder` (claim refuses a live lease, renew, self-fence at TTL−5 s, epoch-guarded revoke, record cache, per-event appends, drain hands off running tools, OnceLedger, stop, idle).         |
| #1800 | Runnable agent host: `session-runtime-factory.ts`, Redis bus, `main.ts`, two-host e2e over a real daemon and test Postgres.                                                                                                     |
| #1802 | Agent host config from encrypted dotenvx tier files.                                                                                                                                                                            |

**Live infrastructure** (created, do not recreate):
- Render `atlas-agent-host` `srv-dblaiqrncjis73d9q12g`: Comp AI workspace, virginia, standard, 2 instances,
  shutdown 300 s, auto-deploy from main with a build filter. Env holds only `DOTENV_PRIVATE_KEY_PRODUCTION_ENC`,
  `BUN_VERSION`, `NODE_ENV`. Status/logs: Render API with `$RENDER_API_KEY`
  (`/v1/services/<id>/deploys`, `/v1/logs?ownerId=tea-cvi2tf7noe9s73aqppe0&resource=<id>`). Both instances log
  `agent-host started`; no session has run on it yet.
- trigger.dev "Atlas v2" `proj_muqwamionbikynuchupc`: `reconcile-holders` deployed (v20261104.1), every minute.
- #1807 (merged 2026-11-04) moved the api/trigger tier files to `apps/<app>/.env.<tier>.enc` and renamed vendor keys
  to `DOTENV_PRIVATE_KEY_PRODUCTION_ENC`.

## Gaps that block exit tests (build these before the live run)

- **Exit test 6 (retry survives a restart):** retry deadlines are not recorded through `OnceLedger`.
  `packages/agent/src/loop/retrying-step.ts` sleeps on its own (`sleepUnlessAborted`, :63); only
  `settle-pending.ts` takes `onceLedger`. Spec point 8: key `retry:<runId>:<step>:<attempt>`, value `notBefore`.
- **Exit test 14 (10 MB tool output):** blob spill (spec point 12, `V2Blob`, >256 KB fields, `v2.blobs.read`) is
  not built.
- **Exit test 2 live:** the agent host runs with `EMPTY_PROMPT`
  (`apps/agent-host/src/runtime/session-runtime-factory.ts:159`); there is no clone or setup script per sandbox
  disk (spec point 7, "Runtime setup"). A live scripted session works without them; real use doesn't.
- `branches-observed` (point 11) is not appended. Not an exit test, but listed in the spec.
- **Exit test 9 (hog):** the cgroup/OOM live test (`ATLAS_LIVE_SANDBOX=1`) has never run in a real sandbox.
- Known test-rig limits: `ScriptedModel` replays its whole script on resume, so handoff e2e tests give host B a
  text-only script; the crash-restart test asserts bash interrupted but not "read reruns".
- `packages/core/src/assembly/rules/messages-from-events.ts` is 453 lines (was 449 on main before slice 3);
  split it when you next touch it.

## PR 4 scope (spec "Delivery" 4)

1. The fault proxy `packages/host/testing/fault-proxy.ts` and the fault matrix F1–F21 run locally against real
   processes (two agent hosts, test Postgres, local daemon), exit tests 3–13 locally.
2. Live tests gated on `ATLAS_LIVE_V2=1`: production Postgres `v2` schema, the Render hosts, a real Vercel sandbox.
   Create sessions through `sessions.create`/`sessions.post` as Dennis (he must have Vercel credentials and an
   Anthropic account connected; `agentHost.config` answers `configured: false` with a gap otherwise).
   Measure exit test 1 again (RTT on the production plan), 8 (append p99), 10 (claim at 20k events, sets
   `AGENT_HOST_MAX_SESSIONS`).
3. Docs: roadmap "Current state" (still says slice 3 not started), architecture §5 (agent host appends to
   Postgres directly), 0021 amended for the rename deferral and the toggle, then the slice 4 handoff.

## Decisions made in PR 3 (add to `slice-3-pr3/decisions.md` or the slice 4 handoff)

- The sandbox never receives `DAEMON_SECRET`: the host mints `daemonToken({ secret, sandboxName })` and passes it as
  `DAEMON_TOKEN` only in the detached `runCommand` env (`/proc/<pid>/environ` would expose the secret).
- `agentHost.config` carries `model: { configured, modelId, accountId, credential: oauth{connectionId} |
  api-key{apiKey} } | { configured: false, gap }`; Anthropic only in slice 3.
- Bash is foreground-only until the shells plugin (slice 7); no clone yet.
- Encrypted tier files at the app root are the source of truth; platforms hold only the private key
  (project memory `encrypted-env-tiers-are-source-of-truth`).

## How the operator works

- Time-box every builder 20–40 min, one slice per brief, no mid-build requirement changes. Builders sit in CI loops
  after pushing: tell them to stop after opening the PR.
- Merge v2 PRs without asking when v1 is unaffected; verify first. A reviewer agent plus your own mutation checks
  found real bugs in every PR this session (back up the file, mutate, restore from the backup, check `git status`;
  don't use `git checkout --`, it has wiped uncommitted work).
- Ask before new kinds of production infrastructure. Touch only Dennis's rows in production.
- Short reports: what changed, what he must do. Never force-push or `--no-verify`.
- Check deploys yourself through the Render/trigger.dev/Vercel APIs; don't tell him you can't watch them.

## Lessons

- CI runs every package's tests in one process; specs must not need `/atlas` paths, docker compose, or a real home.
  The e2e uses temp dirs for `ATLAS_HOME` and the workspace.
- Editing a bundled skill file (`packages/harness/skills/**`) needs `bun scripts/generate-skills.ts` in harness.
- GitHub withholds a failed job's log until the whole run finishes; `gh api .../jobs/<id>/logs` returns nothing
  before that.
- Atlas Cloud has returned 500s that killed builders mid-work; have them commit and push after each item.
- `env -i` breaks mise shims in this pod; unset specific vars instead.

## Suggested skills

`tdd` (fault cases before fixes), `codebase-design` (keep the fault proxy and live harness deep), `atlas` (services,
Render and trigger.dev), `dotenvx` (any new env value goes in the tier files), `code-review`, and `handoff` at the end.
