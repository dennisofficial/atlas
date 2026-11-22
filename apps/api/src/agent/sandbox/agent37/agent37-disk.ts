import type { Agent37Client, Agent37Instance } from './agent37-client'
import { AGENT37_POD_SESSION_KEY } from './agent37-instances'

// https://www.agent37.com/docs/agents-api/instance-sizing.md — an Agent37 vm disk runs from 2 GB to
// 100 GB, and resize only ever grows it.
export const AGENT37_MAX_DISK_GB = 100

export const AGENT37_DISK_METRICS_HOURS = 1

export type Agent37PodDisk = {
  podSessionId: string
  instanceId: string
  usedBytes: number | undefined
  limitBytes: number | undefined
}

const podSessionIdOf = (instance: Agent37Instance): string | undefined =>
  instance.status === 'running' ? instance.metadata?.[AGENT37_POD_SESSION_KEY] : undefined

const lastValueOf = (
  samples: readonly (readonly [number, number])[] | undefined,
): number | undefined =>
  samples === undefined || samples.length === 0 ? undefined : samples[samples.length - 1]?.[1]

const podDiskOf = async (args: {
  client: Agent37Client
  instance: Agent37Instance
  podSessionId: string
}): Promise<Agent37PodDisk> => {
  const pod = {
    podSessionId: args.podSessionId,
    instanceId: args.instance.id,
    usedBytes: undefined,
    limitBytes: undefined,
  }
  try {
    const metrics = await args.client.metrics({
      id: args.instance.id,
      hours: AGENT37_DISK_METRICS_HOURS,
    })
    const usedBytes = lastValueOf(metrics.series?.disk_bytes)
    const limitBytes = metrics.limits?.disk_bytes
    if (usedBytes === undefined || limitBytes === undefined) return pod
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
  grow: async (growArgs: { instanceId: string; diskGb: number }): Promise<void> => {
    // https://www.agent37.com/docs/agents-api/instances/resize — a disk-only grow keeps /atlas but
    // reboots the vm, so it runs while the pod is idle and the caller re-wakes it afterwards.
    await args.client.resize({ id: growArgs.instanceId, disk: growArgs.diskGb })
  },
})
