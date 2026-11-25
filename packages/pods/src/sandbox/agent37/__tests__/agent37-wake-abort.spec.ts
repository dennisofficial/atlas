import { describe, expect, it } from 'bun:test'

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ESandboxProvider } from '@dltech/atlas-protocol'

import type { SandboxTarget } from '../../sandbox-provider'
import type { Agent37Answer, Agent37Client, Agent37Health, Agent37Status } from '../agent37-client'
import { waitForAgent37Daemon, waitForAgent37Instance } from '../agent37-daemon'
import { repairAgent37IfWedged, settleAgent37Instance } from '../agent37-lifecycle'
import { Agent37SandboxProvider } from '../agent37-sandbox-provider'

const HEALTHY: Agent37Health = {
  running: true,
  restart_count: 0,
  exit_code: null,
  oom_suspected: false,
}

const TARGET: SandboxTarget = {
  sandboxSessionId: 'pod-1',
  credentials: { provider: ESandboxProvider.Agent37, apiKey: 'sk_live_test' },
}

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const countingClient = (args: {
  status: Agent37Status
  probe?: Agent37Answer
  health?: () => Agent37Health
}) => {
  const calls = { get: 0, probe: 0, logs: 0, update: 0 }
  const client: Agent37Client = {
    create: async () => ({ id: 'inst-1', status: args.status, url: '' }),
    get: async ({ id }) => {
      calls.get += 1
      return { id, status: args.status, url: `https://${id}.agent37.app` }
    },
    list: async () => ({ data: [] }),
    remove: async () => undefined,
    sleep: async () => undefined,
    start: async ({ id }) => ({ id, status: args.status }),
    resize: async ({ id }) => ({ id, status: args.status, url: '' }),
    update: async ({ id }) => {
      calls.update += 1
      return { id, status: 'updating' }
    },
    edit: async ({ id, metadata }) => ({ id, status: args.status, url: '', metadata }),
    logs: async () => {
      calls.logs += 1
      return { logs: '', truncated: false, health: args.health?.() ?? HEALTHY, fetched_at: 0 }
    },
    exec: async () => ({ exit_code: 0, stdout: '', stderr: '', truncated: false }),
    probe: async () => {
      calls.probe += 1
      return args.probe ?? { status: 0, body: '' }
    },
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
  return { client, calls }
}

const abortedAfter = (ms: number): AbortSignal => AbortSignal.timeout(ms)

describe('agent37 waits stop polling once their signal aborts', () => {
  it('stops settling an instance that stays updating', async () => {
    const { client, calls } = countingClient({ status: 'updating' })

    await expect(
      settleAgent37Instance({ client, id: 'inst-1', pollMs: 5, signal: abortedAfter(20) }),
    ).rejects.toThrow()
    const reads = calls.get
    await pause(50)

    expect(calls.get).toBe(reads)
  })

  it('stops waiting for an instance that never reaches running', async () => {
    const { client, calls } = countingClient({ status: 'starting' })
    const controller = new AbortController()
    const waiting = waitForAgent37Instance({
      client,
      instanceId: 'inst-1',
      signal: controller.signal,
    })
    controller.abort()

    await expect(waiting).rejects.toThrow()
    expect(calls.get).toBe(1)
  })

  it('stops probing a daemon that never answers', async () => {
    const { client, calls } = countingClient({ status: 'running' })

    await expect(
      waitForAgent37Daemon({
        client,
        instanceId: 'inst-1',
        want: { version: 'v1', url: 'https://api/agent/daemon/bundle' },
        token: 'daemon-token',
        pollMs: 5,
        signal: abortedAfter(20),
      }),
    ).rejects.toThrow()
    const probes = calls.probe
    await pause(50)

    expect(calls.probe).toBe(probes)
  })

  it('stops a repair that waits for a reset container to run', async () => {
    const { client, calls } = countingClient({
      status: 'running',
      health: () => ({ ...HEALTHY, running: false, restart_count: 5 }),
    })

    await expect(
      repairAgent37IfWedged({ client, id: 'inst-1', pollMs: 5, signal: abortedAfter(20) }),
    ).rejects.toThrow()
    const reads = calls.logs
    await pause(50)

    expect(calls.update).toBe(1)
    expect(calls.logs).toBe(reads)
  })

  it('makes no call at all when the signal is already aborted', async () => {
    const { client, calls } = countingClient({ status: 'updating' })

    await expect(
      settleAgent37Instance({ client, id: 'inst-1', signal: AbortSignal.abort() }),
    ).rejects.toThrow()

    expect(calls.get).toBe(0)
  })
})

describe('Agent37SandboxProvider.wake past its deadline', () => {
  const providerOf = (client: Agent37Client) => {
    const dir = mkdtempSync(join(tmpdir(), 'atlas-agent37-bundle-'))
    const path = join(dir, 'daemon.js')
    writeFileSync(path, '// daemon bundle\n')
    const provider = new Agent37SandboxProvider({
      env: {
        apiKey: 'sk_live_test',
        template: 'atlas-sandbox@3',
        resources: { cpu: 2, memory: 4, disk: 20 },
      },
      daemonBundle: { path },
      daemonBundleUrl: 'https://api.byatlas.io/agent/daemon/bundle',
      daemonSecret: 'secret',
      client,
      wakeDeadlineMs: 50,
      instances: {
        find: async () => 'inst-1',
        remember: async () => undefined,
        forget: async () => undefined,
        seedStatus: async () => undefined,
      },
    })
    return { provider, cleanup: () => rmSync(dir, { recursive: true }) }
  }

  it('stops reading an instance stuck in a host move', async () => {
    const { client, calls } = countingClient({ status: 'updating' })
    const { provider, cleanup } = providerOf(client)
    try {
      await expect(
        provider.wake({ target: TARGET, signal: new AbortController().signal }),
      ).rejects.toThrow('did not finish waking')
      const reads = calls.get
      await pause(2_200)

      expect(calls.get).toBe(reads)
    } finally {
      cleanup()
    }
  }, 5_000)

  it('stops probing a daemon that the router cannot reach yet', async () => {
    const { client, calls } = countingClient({ status: 'running' })
    const { provider, cleanup } = providerOf(client)
    try {
      await expect(
        provider.wake({ target: TARGET, signal: new AbortController().signal }),
      ).rejects.toThrow('did not finish waking')
      const probes = calls.probe
      await pause(1_200)

      expect(calls.probe).toBe(probes)
    } finally {
      cleanup()
    }
  }, 5_000)
})
