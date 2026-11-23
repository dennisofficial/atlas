# @dltech/atlas-sandbox

The Linux CPU and memory priority of one pod. The package makes the serve process the protected
one. It also puts each command that a thread runs into a small cgroup, with a lower CPU weight and
a higher out-of-memory score. `apps/daemon`, `apps/serve` and `packages/harness` call it.

## Owns

- The daemon's own protection: the cgroup layout, and the `oom_score_adj` of the daemon process.
- The workload policy: the `nice` value, the `oom_score_adj` and the cgroup of a child command.
- The shell prelude that applies the policy to a command, and the wrapped command.
- The cgroup limits, the idle-box sweep and the kill of one workload box.
- The read of the cgroup CPU counter.

## Does not own

- Which commands a thread runs. The harness and the daemon own them.
- The decision that a pod must write its state to disk. `@dltech/atlas-core` owns
  `mirrorsThreadState`, and this package only reads it.
- Container creation and the sandbox image. The API and the pod bootstrap own them.

## Entry points

| Import                  | Use it for                                       |
| ----------------------- | ------------------------------------------------ |
| `@dltech/atlas-sandbox` | The priority, cgroup and CPU helpers of one pod. |

## Capabilities

### Protect the serve process

- `applyDaemonProtection({ env, platform?, root?, meminfo?, writeOomScoreAdj? })`: prepares the
  cgroups with `DAEMON_MEMORY_RESERVE`, sets the marker in `env`, and writes the daemon
  `oom_score_adj`. It returns a report, or `{ enabled: false }` off Linux.
- `applyServePriority({ env, platform?, deps? })`: lowers `oom_score_adj` and `nice` on the serve
  process and on every thread. It returns `{ enabled: false }` outside a pod that mirrors its
  thread state. The function reports a refusal. It does not throw.
- `DAEMON_OOM_SCORE_ADJ`, `SERVE_OOM_SCORE_ADJ`, `SERVE_NICE`: the values.

### Prepare the cgroup layout

- `prepareWorkloadCgroups({ env, platform?, root?, meminfo?, reserve })`: creates `atlas-serve`
  and `atlas-work`, sizes the memory limit from `reserve`, and sets the weights. When
  `reserve.protectedBytes` is above 0, it writes that value to `atlas-serve/memory.min`. It returns
  a report with `ok`, the work group and the limits, or the step that failed.
- `memoryMaxFor({ meminfo, reserve })`, `pidsMaxFor(env)`: the limits of the work group. The work
  group gets the total memory minus `max(reserve.minBytes, total * reserve.fraction)`.
- `MemoryReserve`: `{ minBytes, fraction, protectedBytes }`, chosen by the caller.
- `SERVE_MEMORY_RESERVE`: the v1 serve reserve, `max(1.5 GiB, 25%)`, with no `memory.min`.
- `DAEMON_MEMORY_RESERVE`: the v2 daemon reserve. Commands may use the whole pod, so
  `atlas-work/memory.max` is the pod total. The daemon group gets 384 MiB of `memory.min`, and its
  `oom_score_adj` of -900 against +800 for commands makes the kernel kill a command first.
- `SERVE_GROUP`, `WORK_GROUP`: the cgroup names, `atlas-serve` and `atlas-work`.
- `sweepIdleWorkloadBoxes({ root?, now?, minAgeMs? })`: removes the boxes that are older than
  `minAgeMs`.
- `killWorkloadBox({ pid, env? })`: kills the box of one command.
- `WORKLOAD_CGROUP_ENV`, `WORKLOAD_PIDS_MAX_ENV`, `SANDBOX_WORKLOADS_ENV`: the environment names.

### Demote a command

- `workloadPolicy({ env, platform })`: the `nice`, `oomScoreAdj` and `cgroup` to apply. Each is
  `null` when it does not apply.
- `preludeScript({ policy })`: the shell script, or `null` when there is nothing to apply.
- `demotedCommand({ cmd, cwd?, env?, policy })`: the command, wrapped when a prelude exists.
- `workloadCommand({ cmd, cwd?, env? })`: the same, with the policy of the current process.
- `sandboxWorkloadsEnabled(env)`: true when `ATLAS_SANDBOX_WORKLOADS` is `1`.

### Read the CPU counter

- `readCgroupCpuUsec({ root?, read? })`: the CPU time of the pod in microseconds, or `undefined`.
- `cgroupCpuUsecOf({ stat, acctUsage })`: the same from cgroup v2 or v1 text.
- `CGROUP_ROOT`, `CGROUP_V2_CPU_STAT`, `CGROUP_V1_CPUACCT_USAGE`.

## Usage

```ts
import { workloadCommand } from '@dltech/atlas-sandbox'

const child = Bun.spawn(workloadCommand({ cmd: ['bash'], cwd, env }), { cwd, env })
```

## Rules

- Treat every report as optional. A missing capability returns `{ enabled: false }` or a step
  error. Never throw from a boot path.
- Do not call these functions off Linux, except where the signature takes `platform` for a spec.
- Keep the shell prelude path. It refuses a policy value that is not an integer, so no value
  reaches the shell unchecked.

## See also

- `apps/daemon/src/protection.ts` for the daemon that reports the result to the API.
- `docs/pods.md` for the pod model.
