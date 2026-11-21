import { describe, expect, it } from 'bun:test'

import type { Agent37Client, Agent37Instance, Agent37ResizeArgs } from '../agent37-client'
import { AGENT37_MAX_DISK_GB, agent37DiskOf } from '../agent37-disk'
import type { Agent37Metrics } from '../agent37-metrics'

const GB = 2 ** 30

const instanceOf = (args: {
  id: string
  status?: Agent37Instance['status']
  podSessionId?: string
}): Agent37Instance => ({
  id: args.id,
  status: args.status ?? 'running',
  url: `https://${args.id}.agent37.app`,
  ...(args.podSessionId === undefined
    ? {}
    : { metadata: { atlasPodSessionId: args.podSessionId } }),
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
  return { client, resized, metricsRead }
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

  it('skips an instance that carries no pod session and one with no disk sample yet', async () => {
    const { client, metricsRead } = fakeClient({
      pages: [[instanceOf({ id: 'inst-1' }), instanceOf({ id: 'inst-2', podSessionId: 'pod-2' })]],
      metrics: async () => ({
        ...metricsOf({ limitGb: 20 }),
        series: { disk_bytes: [] },
      }),
    })
    expect(await agent37DiskOf({ client }).runningPods()).toEqual([])
    expect(metricsRead).toEqual(['inst-2'])
  })

  it('skips one pod whose metrics fail rather than failing every pod', async () => {
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
    expect(pods.map((pod) => pod.instanceId)).toEqual(['inst-2'])
  })

  it('grows an instance by the given size and nothing else', async () => {
    const { client, resized } = fakeClient({
      pages: [],
      metrics: async () => metricsOf({ limitGb: 20 }),
    })
    await agent37DiskOf({ client }).grow({ instanceId: 'inst-1', diskGb: 30 })
    expect(resized).toEqual([{ id: 'inst-1', disk: 30 }])
  })

  it('caps growth at the largest vm disk agent37 offers', () => {
    expect(AGENT37_MAX_DISK_GB).toBe(100)
  })
})
