import { describe, expect, it } from 'bun:test'

import { Agent37Error, type Agent37Client } from '../agent37-client'
import {
  AGENT37_WEDGED_RESTARTS,
  agent37WedgedOf,
  readyAgent37Instance,
  repairAgent37IfWedged,
  settleAgent37Instance,
  sleepAgent37Instance,
} from '../agent37-lifecycle'
import type { Agent37Health, Agent37Logs, Agent37Status } from '../agent37-types'

const HEALTHY: Agent37Health = {
  running: true,
  restart_count: 0,
  exit_code: null,
  oom_suspected: false,
}

const logsOf = (health: Agent37Health | null): Agent37Logs => ({
  logs: '',
  truncated: false,
  health,
  fetched_at: 0,
})

const statusesOf = (statuses: readonly Agent37Status[]) => {
  let reads = 0
  const get: Agent37Client['get'] = async ({ id }) => {
    const status = statuses[Math.min(reads, statuses.length - 1)] ?? 'running'
    reads += 1
    return { id, status, url: `https://${id}.agent37.app` }
  }
  return { get, reads: () => reads }
}

const clientOf = (args: { get: Agent37Client['get']; logs?: (() => Agent37Logs) | undefined }) => {
  const updates: string[] = []
  const slept: string[] = []
  const started: string[] = []
  const client: Agent37Client = {
    create: async () => {
      throw new Error('unused')
    },
    get: args.get,
    list: async () => ({ data: [] }),
    remove: async () => undefined,
    sleep: async ({ id }) => void slept.push(id),
    start: async ({ id }) => {
      started.push(id)
      return { id, status: 'running' }
    },
    resize: async ({ id }) => ({ id, status: 'running', url: '' }),
    update: async ({ id }) => {
      updates.push(id)
      return { id, status: 'updating' }
    },
    edit: async ({ id, metadata }) => ({
      id,
      status: 'running',
      url: `https://${id}.agent37.app`,
      metadata,
    }),
    logs: async () => (args.logs === undefined ? logsOf(HEALTHY) : args.logs()),
    exec: async () => ({ exit_code: 0, stdout: '', stderr: '', truncated: false }),
    probe: async () => ({ status: 200, body: '' }),
    signedUrl: async ({ id, port }) => `https://${id}-${port}.agent37.app/?a37_token=a37`,
    usage: async () => ({ from: '', to: '' }),
    metrics: async () => ({
      series: {},
      limits: { cpu_cores: 0, memory_bytes: 0, disk_bytes: 0 },
      hours: 1,
      step_seconds: 60,
      fetched_at: 0,
    }),
    events: async () => ({ from: '', to: '', events: [] }),
  }
  return { client, updates, slept, started }
}

describe('agent37WedgedOf', () => {
  it('is true only for a stopped container that has crash-looped past the threshold', () => {
    expect(agent37WedgedOf(null)).toBe(false)
    expect(agent37WedgedOf(HEALTHY)).toBe(false)
    expect(agent37WedgedOf({ ...HEALTHY, running: false, restart_count: 2 })).toBe(false)
    expect(
      agent37WedgedOf({ ...HEALTHY, running: false, restart_count: AGENT37_WEDGED_RESTARTS }),
    ).toBe(true)
  })
})

describe('settleAgent37Instance', () => {
  it('waits through a resize that leaves the instance updating', async () => {
    const { get, reads } = statusesOf(['updating', 'updating', 'running'])
    const { client } = clientOf({ get })

    const instance = await settleAgent37Instance({ client, id: 'inst-1', pollMs: 1 })

    expect(instance.status).toBe('running')
    expect(reads()).toBe(3)
  })

  it('fails with the status it stayed in when the instance never settles', async () => {
    const { get } = statusesOf(['updating'])
    const { client } = clientOf({ get })

    await expect(
      settleAgent37Instance({ client, id: 'inst-1', budgetMs: 5, pollMs: 1 }),
    ).rejects.toThrow('stayed updating for 0s instead of settling')
  })
})

describe('sleepAgent37Instance', () => {
  it('settles a resized instance before it sleeps it, once', async () => {
    const { get } = statusesOf(['updating', 'updating', 'running'])
    const { client, slept, updates } = clientOf({ get })

    await sleepAgent37Instance({ client, id: 'inst-1', pollMs: 1 })

    expect(slept).toEqual(['inst-1'])
    expect(updates).toEqual([])
  })

  it('repairs a crash-looping container before it sleeps it', async () => {
    const { get } = statusesOf(['running'])
    let reads = 0
    const { client, slept, updates } = clientOf({
      get,
      logs: () => {
        reads += 1
        return logsOf(reads === 1 ? { ...HEALTHY, running: false, restart_count: 5 } : HEALTHY)
      },
    })

    await sleepAgent37Instance({ client, id: 'inst-1' })

    expect(updates).toEqual(['inst-1'])
    expect(slept).toEqual(['inst-1'])
  })

  it('does nothing for an instance that is already asleep', async () => {
    const { get } = statusesOf(['sleeping'])
    const { client, slept, updates } = clientOf({ get })

    await sleepAgent37Instance({ client, id: 'inst-1' })

    expect(slept).toEqual([])
    expect(updates).toEqual([])
  })

  it('treats an instance that vanished as already asleep', async () => {
    const get: Agent37Client['get'] = async () => {
      throw new Agent37Error({ status: 404, code: 'not_found', retryable: false })
    }
    const { client, slept } = clientOf({ get })

    await expect(sleepAgent37Instance({ client, id: 'inst-1' })).resolves.toBeUndefined()
    expect(slept).toEqual([])
  })
})

describe('repairAgent37IfWedged', () => {
  it('leaves a healthy container alone', async () => {
    const { get } = statusesOf(['running'])
    const { client, updates } = clientOf({ get })

    expect(await repairAgent37IfWedged({ client, id: 'inst-1' })).toBe(false)
    expect(updates).toEqual([])
  })

  it('logs why it resets the os layer and waits for the container to run again', async () => {
    const { get } = statusesOf(['running'])
    let reads = 0
    const lines: string[] = []
    const { client, updates } = clientOf({
      get,
      logs: () => {
        reads += 1
        return logsOf(reads === 1 ? { ...HEALTHY, running: false, restart_count: 62 } : HEALTHY)
      },
    })

    const repaired = await repairAgent37IfWedged({
      client,
      id: 'inst-1',
      pollMs: 1,
      log: (line) => lines.push(line),
    })

    expect(repaired).toBe(true)
    expect(updates).toEqual(['inst-1'])
    expect(lines).toContain(
      'agent37 instance inst-1 crash-loops (restart_count 62); resetting its os layer',
    )
  })
})

describe('readyAgent37Instance', () => {
  it('starts a sleeping instance and waits for it to run', async () => {
    const { get } = statusesOf(['sleeping', 'running'])
    const { client, started } = clientOf({ get })

    await readyAgent37Instance({ client, id: 'inst-1' })

    expect(started).toEqual(['inst-1'])
  })

  it('repairs a wedged running instance instead of probing it', async () => {
    const { get } = statusesOf(['running'])
    let reads = 0
    const { client, updates, started } = clientOf({
      get,
      logs: () => {
        reads += 1
        return logsOf(reads === 1 ? { ...HEALTHY, running: false, restart_count: 5 } : HEALTHY)
      },
    })

    await readyAgent37Instance({ client, id: 'inst-1' })

    expect(updates).toEqual(['inst-1'])
    expect(started).toEqual([])
  })
})
