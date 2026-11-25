# Do v2 agents need a services hint?

Answer: yes, a cheap one — but a prompt fragment plus a regex-only before-tool hint, not v1's
decision-model deny.

## 1. How v2 agents use services today (PostHog spans, service `atlas-agent`, 2026-11-20 → 23)

Total `tool` spans: 40,911.

| Tool                                                 | Calls     | Share |
| ---------------------------------------------------- | --------- | ----- |
| `bash`                                               | 30,522    | 74.6% |
| `service`                                            | 46        | 0.11% |
| `service_start` / `service_stop` / `service_restart` | 6 / 4 / 1 | —     |
| `shell` (runInBackground)                            | 177       | 0.4%  |
| `shell_output`                                       | 395       | 1.0%  |

57 service calls in total, from exactly 10 threads, none errored. Bash commands that ran long:

| Bash duration                            | Calls | Share of bash |
| ---------------------------------------- | ----- | ------------- |
| > 60 s                                   | 748   | 2.5%          |
| > 110 s (past the 120 s default ceiling) | 459   | 1.5%          |
| > 300 s                                  | 162   | 0.5%          |
| > 610 s (impossible for a plain timeout) | 4     | 0.01%         |

The median of the > 110 s group is 200 s, so those calls are not timeouts on the default: the
agent raised `timeoutMs` (up to the 600 s ceiling) to keep a long command in the foreground. The
4 spans over 610 s are pod-restart inflation, not the norm — one example repeats a single
`callId` (`toolu_01YbvqHYQZaX9dpqs1je7t5x`) as a 970 s `ok` span and a 931 s `error` span.

Examples (span durations; spans carry `callId`/`threadId` but never the command):
- 1030 s bash, outcome `ok` (2026-11-20 18:55Z, thread `brn_ab381b32…`) — past the 600 s ceiling.
- 970 s then 931 s for the same call id (19:29Z and 19:45Z, thread `419a7e46…`) — one command retried
  across a restart, `ok` then `error`.

Verdict: agents do **not** use services well in v2. They run long doomed foreground commands an
order of magnitude more often than they start a service — a dev server, a watch, a test loop —
and each of those costs minutes of the turn.

## 2. What v1's hook did

`ServiceShapeHook` (`packages/harness/src/hooks/service-shape-hook.ts:33`), registered for every
v1 session in `packages/harness/src/hooks/register-hooks.ts:71`.
- Fires as a before-tool hook at `EStage.Policy`, `nudge: 1` — on every tool call of every turn.
- Returns allow unless `call.name === 'bash'` (line 45). Only bash is inspected.
- Then `serverShapeSuspected(command)` (`packages/core/src/policy/service-shape.ts:13`): five
  regexes — a runner script (`bun/npm/pnpm/yarn/npx/deno/node` + `dev|start|serve|storybook|watch|preview`),
  a known long-lived binary (`vite`, `next dev`, `uvicorn`, `docker compose up`, …), `--watch`, and
  `nohup` or a trailing `&`.
- Only on a match does it spend a decision-model call (`DecisionPort` → JEV, `jevServiceQuestions`)
  on "does this start a long-lived process?". At ≥ 0.25 (`SERVICE_SHAPE_THRESHOLD`) it denies with:
  "run it with `service_start` instead — a service keeps its logs, never times out, and outlives
  the turn. If this command really does its work and exits, say why and run it again."
- Fail-open: no `DecisionPort`, a failed decision, or a missing probability all allow.

v1 additionally carried a long `PREVIEW_PROMPT` that teaches `.atlas/services.yaml` end to end
(`packages/harness/src/agents/types/built-ins.ts:60`). v2 has neither: `packages/agent` does not
import `@dltech/atlas-harness`, and no `serverShapeSuspected`/`serviceShape` reference exists under
`packages/agent`, `packages/plugin-sdk` or `plugins/`. v2's only services prompt is
`ServicesFragment` (`plugins/services/src/pod/fragment.ts`), which explains the `service` tool and
previews but never says when a bash command should have been a service.

## 3. What Amp does

Amp (ampcode.com, by Sourcegraph) supervises declared services and puts the "use a service, never a
background `&`" rule in its agent instructions — no deny hook in evidence.
- `.amp/services.yaml` declares the repository's long-running services, committed with the repo.
  Fields: `command`, `cwd`, `port`, `env` (with `${services.web.publicURL}` references), `health`,
  `portal`, `portals`, `review`, `platforms`. Amp owns `PORT`, `PUBLIC_URL` and `AMP_THREAD_ID`.
- `amp orb services ensure` starts every declared service, waits for readiness, and prints the
  portal URLs; `amp orb service list|status|logs|restart|stop` inspects and controls them. A
  portal click also runs ensure. One-off servers go through `amp orb service start <name>
  --command … --portal`, which refuses a name already declared.
- Portals are authenticated URLs for servers inside the orb (the operator opens a dev server or
  preview from the thread), i.e. Amp's name for our previews.
- The agent-facing rule: "Do not use `nohup`, `setsid`, a background `&`, or tmux to keep a portal
  server alive. Processes started that way can be stopped when Amp updates or the orb resumes. Use
  a supervised service." Its project-config surfaces are `.agents/setup` (prepare the environment,
  explicitly _not_ start servers) and `.agents/resume` (quick repair, ≤ 10 s).
- Sources: [Portals & Desktop](https://ampcode.com/docs/orbs/portals),
  [Tools](https://ampcode.com/docs/tools), [AGENTS.md](https://ampcode.com/docs/customize/agents-md).

Comparison with `.atlas/services.yaml` (`packages/core/src/services/declaration.ts:51`): we already
have the same shape — `command`, `cwd`, `port`, `health`, `env`, `needs` (Amp infers order from
env references), `portal`/`portals`, plus `setup` and `type`, which Amp splits into
`.agents/setup` and platform filtering. Amp has two things we lack: a shell command
(`amp orb services ensure`) that a human or a script can run outside the model, and `platforms`.
We have `portals` links and generated previews already. So "a mix of our services.yaml" is
already 80% built: **the gap is instruction, not file format.**

## 4. Recommendation — a mix, weighted to instruction

Ranked by cost per unit of behaviour change:

**A. Grow the services prompt fragment (do this first).** One paragraph in
`plugins/services/src/pod/fragment.ts` (services plugin `prompts: [new ServicesFragment()]`,
`plugins/services/src/pod/index.ts:26`): before running a dev server, watcher or any command that
does not exit, look for the name in `.atlas/services.yaml` and `service` start it by name; a server
the file does not declare is `service` start with `command` and `port`; never hold a server in
`bash` with `runInBackground`, `&`, `nohup`, a raised `timeoutMs` or a formatter. No latency, no
new mechanism, hits every session and every surface because it is a plugin prompt.

**B. Regex-only before-tool hint in the services plugin.** `PodSlot.beforeTool`
(`packages/plugin-sdk/src/compose-pod.ts:26`) already exists and composes into the v2 chain
(`packages/agent/src/hooks/registry.ts`). Port `serverShapeSuspected`
(`packages/core/src/policy/service-shape.ts:13`) — it is pure `core`, reusable — and deny once per
conversation when a bash command matches **and** `(timeoutMs ?? 0) > 60_000` or
`runInBackground === true`, with v1's teaching sentence. Drop v1's decision-model call: the regex
already fires on ~2.5% of commands, and a model round trip on each is the expensive part of v1's
version. Denying on `runInBackground` too covers the current escape hatch that v1 never saw.

**C. No hook, prompt only.** Cheapest, but v1 shipped both and its prompt still meant a hook was
needed; the 459 long bash calls say the current fragment is not enough on its own.

**Do not** re-add a `DecisionPort`-scored deny, and do not deny on length alone (`timeoutMs` > 60 s
also catches a legitimate 5-minute test run) — key the guard to the server-shaped regex, and keep it
a one-shot hint so a second identical call is allowed with the reason.

Measure with the same spans: `tool="service"` count per week against bash calls over 110 s. Today:
10 threads and 57 service calls against 459 bash calls over 110 s per 3 days.
