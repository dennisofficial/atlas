import { describe, expect, it } from 'bun:test'

import type { Agent37Client, Agent37Instance, Agent37ResizeArgs } from '../agent37-client'
import { AGENT37_MAX_DISK_GB, agent37DiskOf } from '../agent37-disk'
import type { Agent37Metrics } from '../agent37-metrics'

const GB = 2 ** 30

const instanceOf = (args: {
  id: string
  status?: Agent37Instance['status']
  podSessionId?: string
  nudgedPercent?: string
}): Agent37Instance => ({
  id: args.id,
  status: args.status ?? 'running',
  url: `https://${args.id}.agent37.app`,
  ...(args.podSessionId === undefined && args.nudgedPercent === undefined
    ? {}
    : {
        metadata: {
          ...(args.podSessionId === undefined ? {} : { atlasPodSessionId: args.podSessionId }),
          ...(args.nudgedPercent === undefined
            ? {}
            : { atlasDiskNudgedPercent: args.nudgedPercent }),
        },
      }),
})

const metricsOf = (args: { usedGb?: number; limitGb: number }): Agent37Metrics => ({
  series: {
    disk_bytes: args.usedGb === undefined ? [] : [[1_783_293_600, args.usedGb * GB]],
  },
  limits: { cpu_cores: 2, memory_bytes: 4 * GB, disk_bytes: args.limitGb * GB },
  hours: 1,
  step_seconds: 60,
  fetched_at: 1_783_293_660,
})

const fakeClient = (args: {
  pages: Agent37Instance[][]
  metrics: (id: string) => Promise<Agent37Metrics>
}) => {
  const resized: Agent37ResizeArgs[] = []
  const metricsRead: string[] = []
  const edits: Array<{ id: string; metadata: Record<string, string> }> = []
  const client: Agent37Client = {
    create: async () => instanceOf({ id: 'created' }),
    get: async ({ id }) => instanceOf({ id }),
    list: async (_listArgs) => {
      const page = args.pages.shift()
      if (page === undefined) return { data: [] }
      return args.pages.length === 0 ? { data: [...page] } : { data: [...page], next: 'cursor-2' }
    },
    remove: async () => undefined,
    sleep: async () => undefined,
    start: async ({ id }) => ({ id, status: 'running' }),
    update: async ({ id }) => ({ id, status: 'running' }),
    edit: async ({ id, metadata }) => {
      edits.push({ id, metadata })
      const podSessionId = metadata.atlasPodSessionId
      return instanceOf({ id, ...(podSessionId === undefined ? {} : { podSessionId }) })
    },
    logs: async () => ({ logs: '', truncated: false, health: null, fetched_at: 0 }),
    resize: async (body) => {
      resized.push(body)
      return instanceOf({ id: body.id })
    },
    exec: async () => ({ exit_code: 0, stdout: '', stderr: '', truncated: false }),
    probe: async () => ({ status: 200, body: '' }),
    signedUrl: async ({ id }) => `https://${id}.agent37.app/?a37_token=t`,
    usage: async () => ({ from: '', to: '' }),
    events: async () => ({ from: '', to: '', events: [] }),
    metrics: async ({ id }) => {
      metricsRead.push(id)
      return await args.metrics(id)
    },
  }
  return { client, resized, metricsRead, edits }
}

describe('agent37DiskOf', () => {
  it('reports the last disk sample of every running pod, across pages', async () => {
    const { client } = fakeClient({
      pages: [
        [
          instanceOf({ id: 'inst-1', podSessionId: 'pod-1' }),
          instanceOf({ id: 'inst-2', status: 'sleeping', podSessionId: 'pod-2' }),
        ],
        [instanceOf({ id: 'inst-3', podSessionId: 'pod-3' })],
      ],
      metrics: async (id) =>
        id === 'inst-3'
          ? metricsOf({ usedGb: 17, limitGb: 20 })
          : metricsOf({ usedGb: 2, limitGb: 20 }),
    })
    const pods = await agent37DiskOf({ client }).runningPods()
    expect(pods).toEqual([
      { podSessionId: 'pod-1', instanceId: 'inst-1', usedBytes: 2 * GB, limitBytes: 20 * GB },
      { podSessionId: 'pod-3', instanceId: 'inst-3', usedBytes: 17 * GB, limitBytes: 20 * GB },
    ])
  })

  it('reports a pod with no disk sample yet, and reads no metrics for one with no pod session', async () => {
    const { client, metricsRead } = fakeClient({
      pages: [[instanceOf({ id: 'inst-1' }), instanceOf({ id: 'inst-2', podSessionId: 'pod-2' })]],
      metrics: async () => ({
        ...metricsOf({ limitGb: 20 }),
        series: { disk_bytes: [] },
      }),
    })
    expect(await agent37DiskOf({ client }).runningPods()).toEqual([
      {
        podSessionId: 'pod-2',
        instanceId: 'inst-2',
        usedBytes: undefined,
        limitBytes: undefined,
      },
    ])
    expect(metricsRead).toEqual(['inst-2'])
  })

  it('reports the highest recent sample, not merely the last', async () => {
    const { client } = fakeClient({
      pages: [[instanceOf({ id: 'inst-1', podSessionId: 'pod-1' })]],
      metrics: async () => ({
        ...metricsOf({ limitGb: 20 }),
        series: {
          disk_bytes: [
            [1_783_293_600 - 120, 18 * GB],
            [1_783_293_600 - 60, 5 * GB],
          ],
        },
      }),
    })
    expect(await agent37DiskOf({ client }).runningPods()).toEqual([
      { podSessionId: 'pod-1', instanceId: 'inst-1', usedBytes: 18 * GB, limitBytes: 20 * GB },
    ])
  })

  it('reports a pod whose every disk sample is stale as stale', async () => {
    const { client } = fakeClient({
      pages: [[instanceOf({ id: 'inst-1', podSessionId: 'pod-1' })]],
      metrics: async () => ({
        ...metricsOf({ limitGb: 20 }),
        series: { disk_bytes: [[1_783_293_660 - 600, 12 * GB]] },
      }),
    })
    expect(await agent37DiskOf({ client }).runningPods()).toEqual([
      {
        podSessionId: 'pod-1',
        instanceId: 'inst-1',
        usedBytes: undefined,
        limitBytes: undefined,
        stale: true,
      },
    ])
  })

  it('reports one pod whose metrics fail without figures, rather than failing every pod', async () => {
    const { client } = fakeClient({
      pages: [
        [
          instanceOf({ id: 'inst-1', podSessionId: 'pod-1' }),
          instanceOf({ id: 'inst-2', podSessionId: 'pod-2' }),
        ],
      ],
      metrics: async (id) => {
        if (id === 'inst-1') throw new Error('503 try_again')
        return metricsOf({ usedGb: 18, limitGb: 20 })
      },
    })
    const pods = await agent37DiskOf({ client }).runningPods()
    expect(pods).toEqual([
      {
        podSessionId: 'pod-1',
        instanceId: 'inst-1',
        usedBytes: undefined,
        limitBytes: undefined,
      },
      { podSessionId: 'pod-2', instanceId: 'inst-2', usedBytes: 18 * GB, limitBytes: 20 * GB },
    ])
  })

  it('grows an instance by the given size and nothing else', async () => {
    const { client, resized } = fakeClient({
      pages: [],
      metrics: async () => metricsOf({ limitGb: 20 }),
    })
    await agent37DiskOf({ client }).grow({ instanceId: 'inst-1', diskGb: 30 })
    expect(resized).toEqual([{ id: 'inst-1', disk: 30 }])
  })

  it('reports the nudge level the instance metadata holds, and ignores garbage', async () => {
    const { client } = fakeClient({
      pages: [
        [
          instanceOf({ id: 'inst-1', podSessionId: 'pod-1', nudgedPercent: '85' }),
          instanceOf({ id: 'inst-2', podSessionId: 'pod-2', nudgedPercent: 'not-a-number' }),
        ],
      ],
      metrics: async () => metricsOf({ usedGb: 90, limitGb: 100 }),
    })
    expect(await agent37DiskOf({ client }).runningPods()).toEqual([
      {
        podSessionId: 'pod-1',
        instanceId: 'inst-1',
        usedBytes: 90 * GB,
        limitBytes: 100 * GB,
        nudgedPercent: 85,
      },
      { podSessionId: 'pod-2', instanceId: 'inst-2', usedBytes: 90 * GB, limitBytes: 100 * GB },
    ])
  })

  it('writes the nudge level beside the pod session, since metadata replaces the whole map', async () => {
    const { client, edits } = fakeClient({
      pages: [],
      metrics: async () => metricsOf({ limitGb: 20 }),
    })
    const disk = agent37DiskOf({ client })
    await disk.markNudged({ instanceId: 'inst-1', podSessionId: 'pod-1', percent: 95 })
    await disk.markNudged({ instanceId: 'inst-2', podSessionId: 'pod-2', percent: undefined })
    expect(edits).toEqual([
      { id: 'inst-1', metadata: { atlasPodSessionId: 'pod-1', atlasDiskNudgedPercent: '95' } },
      { id: 'inst-2', metadata: { atlasPodSessionId: 'pod-2' } },
    ])
  })

  it('caps growth at the largest vm disk agent37 offers', () => {
    expect(AGENT37_MAX_DISK_GB).toBe(100)
  })
})
