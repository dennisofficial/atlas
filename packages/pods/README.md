# @dltech/atlas-pods

The sandbox provider layer and the pod job logic that runs: the Vercel and Agent37 adapters,
the pod sleep, resize, disk-grow and orphan sweeps, the control-plane plugin list, and the env
they read. `apps/api` and `apps/trigger` both use it. It has no framework import.

## Owns

- The `SandboxProvider` port and the two adapters that implement it.
- The sandbox provider registry, daemon launch, and the sandbox run-close bookkeeping.
- Reading a session's `SandboxConfig` from the database and the platform credentials.
- The pod job bodies: sleep, resize, disk grow, and the agent37 usage reconcile.
- The pod identity rules (`pods`, `podStillRetirable`) and the pod sweep.
- The control-plane plugin list and `jobsControlPlaneOf`.
- `readPodsEnv`, the env the providers and jobs read.

## Does not own

- The NestJS wiring, controllers and routers. `apps/api` owns them. The trigger.dev task
  definitions are in `apps/trigger`.
- Task ids and payload schemas. `@dltech/atlas-jobs` owns them.
- The control plane store and its transactions. `@dltech/atlas-control` owns them.

## Entry points

| Import                 | Use it for                                                                 |
| ---------------------- | -------------------------------------------------------------------------- |
| `@dltech/atlas-pods`   | The whole public surface: env, sandbox providers, pod jobs, plugin list.   |
| `@dltech/atlas-pods/*` | One module by path, such as `@dltech/atlas-pods/sandbox/sandbox-provider`. |

## Capabilities

### Read the env

- `readPodsEnv(env?)` reads `PodsEnv` and throws `PodsEnvError` naming every missing var.
- Required: `DAEMON_SECRET`, `SECRETS_ENCRYPTION_KEY`, `ATLAS_API_ORIGIN`.
- A partial `PLATFORM_VERCEL_*` triple is an error.
- Optional: `PLATFORM_VERCEL_TOKEN`/`_TEAM_ID`/`_PROJECT_ID`, `AGENT37_API_KEY`/`AGENT37_TEMPLATE_ID`,
  `AGENT37_CPU`, `AGENT37_MEMORY_GB`, `AGENT37_DISK_GB`, `ATLAS_SANDBOX_IMAGE`,
  `ATLAS_DAEMON_BUNDLE`, `AGENT_HOST_PUBLIC_URL`.

### Reach a sandbox

- `sandboxProvidersOf({ env, db })` builds the registry from the env.
- `sandboxSleeperOf({ config, sandbox })` and `sandboxResizerOf({ config, sandbox })` take a
  `SandboxConfigSource`.
- `podSleeperOf({ env, db })` and `podResizerOf({ env, db })` wire the registry and the config
  source for a pod. Both throw `SandboxNotConfiguredError` when the session has no usable
  credential.
- `sandboxLiveCpuMs({ sessionId })` reads the Vercel CPU series from a 30 s cache.
- A `DaemonEndpoint` carries `start`: `EPodStart` says the wake created the pod, woke it,
  repaired a crash loop, or found it already `running`. Agent37 also returns optional `stages`:
  `instanceStartMs` measures start to running (zero if already running), and `daemonReadyMs`
  measures running to a compatible daemon response, including a daemon restart. Both use a
  monotonic clock.

### Read the sandbox config

- `readSandboxConfig({ db, platform, sessionId })` returns the provider, the platform credentials
  and the vcpus, memory and disk the session asked for.
- `sandboxConfigSourceOf({ db, env })` gives the read as a `SandboxConfigSource`.
- `SessionNotFoundError` is what an unknown session raises.

### Run a pod job

- `runPodSleep`, `runPodResize`, `runPodDiskGrow`, `growPodDisk` are plain
  functions over injected deps: no database, clock or network of their own.
- `readPodBusy` and `readPodRebootFacts` read a session's busy state from a `ControlPlane`.
- `readPodStopBusy` reads what holds a stop: the setup script and an agent turn. The stop waits for
  them and then sleeps the pod.
- `readPodResizeBusy` reads what holds a resize: the setup script, shells, services and a
  foreground bash command. Agent turns, other tool calls and sub-agents never hold one.
  `podBusyFactsOfState({ state, now })` reads the same facts from a folded session view.
- A whenIdle `runPodResize` on a busy pod records the wait once and ends. `podResizeOnIdleHook({
  dispatch, warn })` is the control-plane view hook that pushes the waiting resize when an append
  takes the pod from busy to idle. The resumed run claims the wait, so one wait resizes once. A run
  that a newer generation superseded posts no `pod-resized` notice.
- `POD_RESIZE_MAX_DURATION_SECONDS` is the pod-resize task budget. It outlasts the slowest
  agent37 resize, so a provider timeout fails the run before trigger.dev kills it.
- `reconcileAgent37Usage` meters the instances the wallet billed.
- `POD_DISK_GROWN_LIFETIME_STEPS` and `podDiskGrownNotice(diskGb)` are the inbox nudge a grown pod
  leaves for its session.
- `POD_DISK_CEILING_LIFETIME_STEPS` and `podDiskCeilingNotice({ usedBytes, limitBytes, percent })`
  are the inbox nudge a pod at the 100 GB ceiling leaves for its session at 85% and 95% full.
- `PodDiskGrowDeps.started` reports the pod a successful grow restarted, with the disk it grew
  from and to.

### Sweep pods

- `pods({ now })` gives the live pods, the retirable ones and their sessions.
- `podStillRetirableIn({ tx, podSessionId, now })` re-checks one pod inside its fence.
- `sweepPods`, `planPods` and `uniqueScopes` stop and delete the pods nothing can reach.
- `endPodTerminals({ podSessionIds })` closes the terminal rows of a retired pod.
- `ARCHIVED_SANDBOX_GRACE_MS` is the six-hour grace both sweeps measure from `archivedAt`.

### Compose one plugin list

- `registeredPlugins` and `composedPlugins` are the plugin list that the trigger.dev worker builds
  a control plane from. `apps/api` builds its own list in
  `apps/api/src/agent/registered-plugins.ts`.
- `jobsControlPlaneOf({ db })` builds a `ControlPlane` over Postgres with that list.
- `composedControlPlaneOver({ store })` builds the same `ControlPlane` over any store. A plane
  built without the list cannot read a stored plugin event.

## Usage

```ts
import { podSleeperOf, readPodsEnv } from '@dltech/atlas-pods'
import { db } from '@dltech/atlas-db'

const env = readPodsEnv()
const sleeper = podSleeperOf({ env, db })

await sleeper.sleep({ sandboxSessionId: 'ses_123' })
```

## Rules

- No framework import here. The NestJS wiring belongs in `apps/api`.
- Build the deps by hand at the caller: this package holds no singleton and no connection.
- Take the task ids and payload schemas from `@dltech/atlas-jobs`.

## See also

- `packages/jobs` names the tasks these functions run under.
- `apps/trigger/src` builds the graphs that call them today, such as `pod-power/pod-sleep-graph.ts`.
