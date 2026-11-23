import { availableParallelism } from 'node:os'

import { type PodCgroupCounters, type PodSample, podSampleOf } from '@dltech/atlas-core'
import {
  CallFailureError,
  ECallFailure,
  METRICS_INTERVAL_MS,
  METRICS_RING_SIZE,
} from '@dltech/atlas-protocol'
import {
  type DaemonGroup,
  type DaemonGroupFactory,
  type GroupContext,
  defineOp,
} from '@dltech/atlas-protocol/engine'
import { CGROUP_ROOT } from '@dltech/atlas-sandbox'

import type { DaemonOpsDeps } from '../deps'
import { oomRecorderOf } from '../oom/recorder'
import {
  METRICS_CGROUP_ROOT_ENV,
  METRICS_DISK_ROOT_ENV,
  METRICS_PROC_ROOT_ENV,
  SANDBOX_VOLUME_ROOT,
  podVcpusOf,
  readFirstPodDisk,
  readPodCounters,
} from './cgroup'

export const METRICS_INTERVAL_ENV = 'ATLAS_METRICS_INTERVAL_MS'
export { METRICS_CGROUP_ROOT_ENV }

const MIN_INTERVAL_MS = 10

const intervalOf = (env: Record<string, string | undefined>): number => {
  const asked = Number(env[METRICS_INTERVAL_ENV])
  if (!Number.isFinite(asked) || asked < MIN_INTERVAL_MS) return METRICS_INTERVAL_MS
  return Math.floor(asked)
}

const recentOf = (args: {
  ring: readonly PodSample[]
  now: number
  intervalMs: number
}): PodSample[] => {
  const oldest = args.now - METRICS_RING_SIZE * args.intervalMs
  return args.ring.filter((sample) => sample.at >= oldest)
}

export const metricsGroup =
  (deps: DaemonOpsDeps): DaemonGroupFactory =>
  (groupCtx: GroupContext): DaemonGroup => {
    const root = deps.env[METRICS_CGROUP_ROOT_ENV] ?? CGROUP_ROOT
    const proc = deps.env[METRICS_PROC_ROOT_ENV] ?? '/proc'
    const explicitDiskRoot = deps.env[METRICS_DISK_ROOT_ENV]
    const diskRoots =
      explicitDiskRoot === undefined ? [SANDBOX_VOLUME_ROOT, deps.home] : [explicitDiskRoot]
    const intervalMs = intervalOf(deps.env)
    const vcpus = podVcpusOf({ root, fallback: availableParallelism() })
    const ring: PodSample[] = []
    let subscribers = 0
    let prev: PodCgroupCounters | null = null
    let lastAt = 0

    const countersNow = (): PodCgroupCounters | null => {
      const counters = readPodCounters({ root, proc })
      if (counters === null) return null
      const recorder = oomRecorderOf(deps)
      const commandMemoryLimitBytes = recorder.commandRamLimitBytes()
      return {
        ...counters,
        ...(readFirstPodDisk({ roots: diskRoots }) ?? {}),
        oomEvents: recorder.journal.count,
        ...(commandMemoryLimitBytes === null ? {} : { commandMemoryLimitBytes }),
      }
    }

    const sample = (): void => {
      const next = countersNow()
      const at = Date.now()
      if (next === null) return
      const last = prev
      prev = next
      if (last === null) return
      const measured = podSampleOf({
        prev: last,
        next,
        intervalMs: Math.max(MIN_INTERVAL_MS, at - lastAt),
        vcpus,
        at,
      })
      lastAt = at
      ring.push(measured)
      if (ring.length > METRICS_RING_SIZE) ring.shift()
      if (subscribers > 0) groupCtx.publish({ type: 'metrics.sample', sample: measured })
    }

    prev = countersNow()
    lastAt = Date.now()
    const timer = setInterval(sample, intervalMs)
    timer.unref()

    return {
      name: 'metrics',
      ops: [
        defineOp({
          op: 'metrics.subscribe',
          run: () => {
            if (countersNow() === null) {
              throw new CallFailureError({
                code: ECallFailure.NotFound,
                message: 'pod metrics are not readable',
              })
            }
            subscribers += 1
            return Promise.resolve({
              samples: recentOf({ ring, now: Date.now(), intervalMs }),
            })
          },
        }),
        defineOp({
          op: 'metrics.unsubscribe',
          run: () => {
            subscribers = Math.max(0, subscribers - 1)
            return Promise.resolve(null)
          },
        }),
      ],
      onDisconnect: () => {
        subscribers = 0
      },
      stop: () => {
        subscribers = 0
        clearInterval(timer)
        ring.length = 0
        return Promise.resolve()
      },
    }
  }
