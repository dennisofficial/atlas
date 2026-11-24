import type { Agent37Client, Agent37Instance } from './agent37-client'
import { AGENT37_DISK_NUDGED_KEY, AGENT37_POD_SESSION_KEY } from './agent37-instances'

// https://www.agent37.com/docs/agents-api/instance-sizing.md — an Agent37 vm disk runs from 2 GB to
// 100 GB, and resize only ever grows it.
export const AGENT37_MAX_DISK_GB = 100

export const AGENT37_DISK_METRICS_HOURS = 1

export const AGENT37_DISK_SAMPLE_MAX_AGE_SECONDS = 300

export type Agent37PodDisk = {
  podSessionId: string
  instanceId: string
  usedBytes: number | undefined
  limitBytes: number | undefined
  stale?: boolean | undefined
  nudgedPercent?: number | undefined
}

const podSessionIdOf = (instance: Agent37Instance): string | undefined =>
  instance.status === 'running' ? instance.metadata?.[AGENT37_POD_SESSION_KEY] : undefined

const nudgedPercentOf = (instance: Agent37Instance): number | undefined => {
  const raw = instance.metadata?.[AGENT37_DISK_NUDGED_KEY]
  if (raw === undefined) return undefined
  const percent = Number.parseInt(raw, 10)
  return Number.isNaN(percent) ? undefined : percent
}

const maxValueSince = (args: {
  samples: readonly (readonly [number, number])[]
  sinceSeconds: number
}): number | undefined => {
  let max: number | undefined
  for (const sample of args.samples) {
    const [at, value] = sample
    if (at < args.sinceSeconds) continue
    if (max === undefined || value > max) max = value
  }
  return max
}

const podDiskOf = async (args: {
  client: Agent37Client
  instance: Agent37Instance
  podSessionId: string
}): Promise<Agent37PodDisk> => {
  const nudgedPercent = nudgedPercentOf(args.instance)
  const pod = {
    podSessionId: args.podSessionId,
    instanceId: args.instance.id,
    usedBytes: undefined,
    limitBytes: undefined,
    ...(nudgedPercent === undefined ? {} : { nudgedPercent }),
  }
  try {
    const metrics = await args.client.metrics({
      id: args.instance.id,
      hours: AGENT37_DISK_METRICS_HOURS,
    })
    const samples = metrics.series?.disk_bytes
    const limitBytes = metrics.limits?.disk_bytes
    if (samples === undefined || samples.length === 0) return pod
    const usedBytes = maxValueSince({
      samples,
      sinceSeconds: metrics.fetched_at - AGENT37_DISK_SAMPLE_MAX_AGE_SECONDS,
    })
    if (usedBytes === undefined) return { ...pod, stale: true }
    if (limitBytes === undefined) return pod
    return { ...pod, usedBytes, limitBytes }
  } catch {
    return pod
  }
}

export const agent37DiskOf = (args: { client: Agent37Client }) => ({
  runningPods: async (): Promise<Agent37PodDisk[]> => {
    const pods: Agent37PodDisk[] = []
    let cursor: string | undefined
    for (;;) {
      const page = await args.client.list(cursor === undefined ? {} : { cursor })
      for (const instance of page.data) {
        const podSessionId = podSessionIdOf(instance)
        if (podSessionId === undefined) continue
        pods.push(await podDiskOf({ client: args.client, instance, podSessionId }))
      }
      if (page.next === undefined) return pods
      cursor = page.next
    }
  },
  markNudged: async (markArgs: {
    instanceId: string
    podSessionId: string
    percent: number | undefined
  }): Promise<void> => {
    // https://www.agent37.com/docs/agents-api/instances/edit.md — editing metadata keeps the vm
    // running, but the map replaces the stored one, so the pod session id goes with it.
    await args.client.edit({
      id: markArgs.instanceId,
      metadata: {
        [AGENT37_POD_SESSION_KEY]: markArgs.podSessionId,
        ...(markArgs.percent === undefined
          ? {}
          : { [AGENT37_DISK_NUDGED_KEY]: String(markArgs.percent) }),
      },
    })
  },
  grow: async (growArgs: { instanceId: string; diskGb: number }): Promise<void> => {
    // https://www.agent37.com/docs/agents-api/instances/resize — a disk-only grow keeps /atlas but
    // reboots the vm, so it runs while the pod is idle and the caller re-wakes it afterwards.
    await args.client.resize({ id: growArgs.instanceId, disk: growArgs.diskGb })
  },
})
