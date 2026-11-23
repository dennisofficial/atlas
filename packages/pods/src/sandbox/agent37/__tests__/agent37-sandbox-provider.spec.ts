import { describe, expect, it } from 'bun:test'

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ESandboxProvider } from '@dltech/atlas-protocol'
import { daemonToken } from '@dltech/atlas-protocol/engine'

import { SandboxUnavailableError } from '@dltech/atlas-host'

import type { SandboxTarget } from '../../sandbox-provider'
import {
  Agent37Error,
  type Agent37Client,
  type Agent37CreateArgs,
  type Agent37ExecArgs,
  type Agent37ResizeArgs,
  type Agent37Resources,
  type Agent37Status,
} from '../agent37-client'
import { agent37BundleVersionOf } from '../agent37-daemon'
import { agent37InstanceNameOf, type Agent37Env } from '../agent37-instances'
import { Agent37SandboxProvider } from '../agent37-sandbox-provider'

const ENV: Agent37Env = {
  apiKey: 'sk_live_test',
  template: 'atlas-sandbox@3',
  resources: { cpu: 2, memory: 4, disk: 20 },
}

const BUNDLE_URL = 'https://api.byatlas.io/agent/daemon/bundle'

const TARGET: SandboxTarget = {
  sandboxSessionId: 'pod-1',
  credentials: { provider: ESandboxProvider.Agent37, apiKey: 'sk_live_test' },
}

const bundle = (): { bundle: { path: string }; cleanup: () => void } => {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-agent37-bundle-'))
  const path = join(dir, 'daemon.js')
  writeFileSync(path, '// daemon bundle\n')
  return { bundle: { path }, cleanup: () => rmSync(dir, { recursive: true }) }
}

const fakeClient = (args: {
  version: string
  get?: Agent37Client['get']
  list?: Agent37Client['list']
  status?: Agent37Status
  resources?: Agent37Resources
  logs?: Agent37Client['logs']
}) => {
  const creates: Agent37CreateArgs[] = []
  const execs: Agent37ExecArgs[] = []
  const slept: string[] = []
  const started: string[] = []
  const resized: Agent37ResizeArgs[] = []
  const removed: string[] = []
  const updated: string[] = []
  const instance = { status: args.status ?? 'running' } as { status: Agent37Status }
  const client: Agent37Client = {
    create: async (body) => {
      creates.push(body)
      return { id: 'inst-1', status: 'running', url: 'https://inst-1.agent37.app' }
    },
    get:
      args.get ??
      (async ({ id }) => ({
        id,
        status: instance.status,
        url: `https://${id}.agent37.app`,
        ...(args.resources === undefined ? {} : { resources: args.resources }),
      })),
    list: args.list ?? (async () => ({ data: [] })),
    remove: async ({ id }) => {
      removed.push(id)
    },
    sleep: async ({ id }) => {
      slept.push(id)
    },
    start: async ({ id }) => {
      started.push(id)
      instance.status = 'running'
      return { id, status: 'running' }
    },
    resize: async (body) => {
      resized.push(body)
      return { id: body.id, status: 'running', url: `https://${body.id}.agent37.app` }
    },
    update: async ({ id }) => {
      updated.push(id)
      return { id, status: 'updating' }
    },
    logs:
      args.logs ??
      (async () => ({
        logs: '',
        truncated: false,
        health: { running: true, restart_count: 0, exit_code: null, oom_suspected: false },
        fetched_at: 0,
      })),
    exec: async (body) => {
      execs.push(body)
      return { exit_code: 0, stdout: '', stderr: '', truncated: false }
    },
    probe: async () => ({ status: 200, body: args.version }),
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
  return { client, creates, execs, slept, started, resized, removed, updated }
}

const providerOf = (args: {
  client: Agent37Client
  bundlePath: string
  stored?: string | null
}) => {
  const remembered: Array<{ podSessionId: string; instanceId: string }> = []
  const seeded: Array<{ podSessionId: string; status: Agent37Status; at: string }> = []
  let stored = args.stored ?? null
  const provider = new Agent37SandboxProvider({
    env: ENV,
    daemonBundle: { path: args.bundlePath },
    daemonBundleUrl: BUNDLE_URL,
    daemonSecret: 'secret',
    client: args.client,
    instances: {
      find: async () => stored,
      remember: async (params) => {
        remembered.push(params)
        stored = params.instanceId
      },
      forget: async () => {
        stored = null
      },
      seedStatus: async (params) => {
        seeded.push(params)
      },
    },
  })
  return { provider, remembered, seeded }
}

describe('Agent37SandboxProvider.wake', () => {
  it('creates the instance once, waits for the daemon and returns the signed port URL', async () => {
    const { bundle: b, cleanup } = bundle()
    const version = await agent37BundleVersionOf(b.path)
    const { client, creates, execs } = fakeClient({ version })
    const { provider, remembered, seeded } = providerOf({ client, bundlePath: b.path })
    try {
      const endpoint = await provider.wake({ target: TARGET, signal: new AbortController().signal })

      expect(creates).toHaveLength(1)
      expect(execs).toHaveLength(0)
      expect(remembered).toEqual([{ podSessionId: 'pod-1', instanceId: 'inst-1' }])
      expect(seeded.map((seed) => [seed.podSessionId, seed.status])).toEqual([['pod-1', 'running']])
      expect(endpoint.url).toBe('wss://inst-1-47300.agent37.app/?a37_token=a37')
      expect(endpoint.sandboxName).toBe(agent37InstanceNameOf('pod-1'))
      expect(endpoint.token).toBe(
        daemonToken({ secret: 'secret', sandboxName: agent37InstanceNameOf('pod-1') }),
      )
    } finally {
      cleanup()
    }
  })

  it('remembers the instance before waiting for it, so a slow pod still finds its session', async () => {
    const { bundle: b, cleanup } = bundle()
    const { client } = fakeClient({
      version: 'unused',
      get: async () => {
        throw new Error('agent37 is unreachable')
      },
    })
    const { provider, remembered } = providerOf({ client, bundlePath: b.path })
    try {
      const waking = provider.wake({ target: TARGET, signal: new AbortController().signal })

      await expect(waking).rejects.toThrow(/unavailable/)
      expect(remembered).toEqual([{ podSessionId: 'pod-1', instanceId: 'inst-1' }])
    } finally {
      cleanup()
    }
  })

  it('settles an instance that is waking before waiting for its daemon', async () => {
    const { bundle: b, cleanup } = bundle()
    const version = await agent37BundleVersionOf(b.path)
    let reads = 0
    const { client, creates, execs } = fakeClient({
      version,
      get: async ({ id }) => {
        reads += 1
        return {
          id,
          status: reads === 1 ? 'waking' : 'running',
          url: `https://${id}.agent37.app`,
        }
      },
    })
    const { provider, seeded } = providerOf({ client, bundlePath: b.path, stored: 'inst-9' })
    try {
      const endpoint = await provider.wake({ target: TARGET, signal: new AbortController().signal })

      expect(creates).toHaveLength(0)
      expect(execs).toHaveLength(0)
      expect(seeded.map((seed) => [seed.podSessionId, seed.status])).toEqual([['pod-1', 'running']])
      expect(endpoint.url).toContain('inst-9-47300')
    } finally {
      cleanup()
    }
  })

  it('repairs a crash-looping running instance before probing its daemon', async () => {
    const { bundle: b, cleanup } = bundle()
    const version = await agent37BundleVersionOf(b.path)
    let reads = 0
    const { client, updated } = fakeClient({
      version,
      logs: async () => {
        reads += 1
        return {
          logs: '',
          truncated: false,
          health:
            reads === 1
              ? { running: false, restart_count: 5, exit_code: null, oom_suspected: false }
              : { running: true, restart_count: 0, exit_code: null, oom_suspected: false },
          fetched_at: 0,
        }
      },
    })
    const { provider } = providerOf({ client, bundlePath: b.path, stored: 'inst-9' })
    try {
      await provider.wake({ target: TARGET, signal: new AbortController().signal })

      expect(updated).toEqual(['inst-9'])
    } finally {
      cleanup()
    }
  })

  it('starts a sleeping instance before waiting for its daemon', async () => {
    const { bundle: b, cleanup } = bundle()
    const version = await agent37BundleVersionOf(b.path)
    const { client, creates, started } = fakeClient({ version, status: 'sleeping' })
    const { provider } = providerOf({ client, bundlePath: b.path, stored: 'inst-9' })
    try {
      const endpoint = await provider.wake({ target: TARGET, signal: new AbortController().signal })

      expect(started).toEqual(['inst-9'])
      expect(creates).toHaveLength(0)
      expect(endpoint.url).toContain('inst-9-47300')
    } finally {
      cleanup()
    }
  })

  it('leaves a running instance alone, without a start', async () => {
    const { bundle: b, cleanup } = bundle()
    const version = await agent37BundleVersionOf(b.path)
    const { client, started } = fakeClient({ version, status: 'running' })
    const { provider } = providerOf({ client, bundlePath: b.path, stored: 'inst-9' })
    try {
      await provider.wake({ target: TARGET, signal: new AbortController().signal })

      expect(started).toEqual([])
    } finally {
      cleanup()
    }
  })

  it('carries the bundle URL, the daemon token and the port in the create env', async () => {
    const { bundle: b, cleanup } = bundle()
    const version = await agent37BundleVersionOf(b.path)
    const { client, creates } = fakeClient({ version })
    const { provider } = providerOf({ client, bundlePath: b.path })
    try {
      await provider.wake({ target: TARGET, signal: new AbortController().signal })
      expect(creates[0]?.env.ATLAS_DAEMON_BUNDLE_URL).toBe(BUNDLE_URL)
      expect(creates[0]?.env.ATLAS_DAEMON_PORT).toBe('47300')
      expect(creates[0]?.env.DAEMON_TOKEN).toBeString()
    } finally {
      cleanup()
    }
  })

  it('carries the memory the instance reports on the endpoint', async () => {
    const { bundle: b, cleanup } = bundle()
    const version = await agent37BundleVersionOf(b.path)
    const { client } = fakeClient({ version, resources: { cpu: 4, memory: 32, disk: 20 } })
    const { provider } = providerOf({ client, bundlePath: b.path, stored: 'inst-9' })
    try {
      const endpoint = await provider.wake({ target: TARGET, signal: new AbortController().signal })

      expect(endpoint.vcpus).toBe(4)
      expect(endpoint.memoryGb).toBe(32)
      expect(endpoint.diskGb).toBe(20)
    } finally {
      cleanup()
    }
  })

  it('stamps the seed before it reads the instance, so a webhook from after the read wins', async () => {
    const { bundle: b, cleanup } = bundle()
    const version = await agent37BundleVersionOf(b.path)
    let readAt = 0
    const { client } = fakeClient({
      version,
      get: async ({ id }) => {
        readAt = Date.now()
        await new Promise((resolve) => setTimeout(resolve, 25))
        return { id, status: 'running', url: `https://${id}.agent37.app` }
      },
    })
    const { provider, seeded } = providerOf({ client, bundlePath: b.path, stored: 'inst-9' })
    try {
      await provider.wake({ target: TARGET, signal: new AbortController().signal })

      expect(readAt).toBeGreaterThan(0)
      expect(Date.parse(seeded[0]?.at ?? '')).toBeLessThanOrEqual(readAt)
    } finally {
      cleanup()
    }
  })
})

describe('Agent37SandboxProvider.resize', () => {
  it('resizes the remembered instance to the vm shape it was asked for, leaving disk alone', async () => {
    const { bundle: b, cleanup } = bundle()
    const version = await agent37BundleVersionOf(b.path)
    const { client, started, resized } = fakeClient({ version })
    const { provider } = providerOf({ client, bundlePath: b.path, stored: 'inst-9' })
    try {
      expect(await provider.resize({ target: TARGET, shape: { vcpus: 4, memoryGb: 16 } })).toBe(
        'restarted',
      )
      expect(resized).toEqual([{ id: 'inst-9', cpu: 4, memory: 16 }])
      expect(started).toEqual([])
    } finally {
      cleanup()
    }
  })

  it('starts a sleeping instance before resizing it', async () => {
    const { bundle: b, cleanup } = bundle()
    const version = await agent37BundleVersionOf(b.path)
    const { client, started, resized } = fakeClient({ version, status: 'sleeping' })
    const { provider } = providerOf({ client, bundlePath: b.path, stored: 'inst-9' })
    try {
      expect(await provider.resize({ target: TARGET, shape: { vcpus: 2, memoryGb: 4 } })).toBe(
        'restarted',
      )
      expect(started).toEqual(['inst-9'])
      expect(resized).toEqual([{ id: 'inst-9', cpu: 2, memory: 4 }])
    } finally {
      cleanup()
    }
  })

  it('leaves an instance already at the target shape alone, and stores the size', async () => {
    const { bundle: b, cleanup } = bundle()
    const version = await agent37BundleVersionOf(b.path)
    const { client, started, resized } = fakeClient({
      version,
      status: 'sleeping',
      resources: { cpu: 4, memory: 8, disk: 20 },
    })
    const { provider } = providerOf({ client, bundlePath: b.path, stored: 'inst-9' })
    try {
      expect(await provider.resize({ target: TARGET, shape: { vcpus: 4, memoryGb: 8 } })).toBe(
        'stored',
      )
      expect(started).toEqual([])
      expect(resized).toEqual([])
    } finally {
      cleanup()
    }
  })

  it('sends only the disk when the shape already matches and the disk has to grow', async () => {
    const { bundle: b, cleanup } = bundle()
    const version = await agent37BundleVersionOf(b.path)
    const { client, started, resized } = fakeClient({
      version,
      status: 'sleeping',
      resources: { cpu: 4, memory: 16, disk: 20 },
    })
    const { provider } = providerOf({ client, bundlePath: b.path, stored: 'inst-9' })
    try {
      expect(
        await provider.resize({
          target: TARGET,
          shape: { vcpus: 4, memoryGb: 16 },
          diskGb: 30,
        }),
      ).toBe('restarted')
      expect(resized).toEqual([{ id: 'inst-9', disk: 30 }])
      expect(started).toEqual(['inst-9'])
    } finally {
      cleanup()
    }
  })

  it('stores a pod whose cpu, memory and disk are already at the target', async () => {
    const { bundle: b, cleanup } = bundle()
    const version = await agent37BundleVersionOf(b.path)
    const { client, resized } = fakeClient({
      version,
      resources: { cpu: 4, memory: 16, disk: 40 },
    })
    const { provider } = providerOf({ client, bundlePath: b.path, stored: 'inst-9' })
    try {
      expect(
        await provider.resize({
          target: TARGET,
          shape: { vcpus: 4, memoryGb: 16 },
          diskGb: 40,
        }),
      ).toBe('stored')
      expect(resized).toEqual([])
    } finally {
      cleanup()
    }
  })

  it('never sends a smaller disk, because agent37 cannot shrink one', async () => {
    const { bundle: b, cleanup } = bundle()
    const version = await agent37BundleVersionOf(b.path)
    const { client, resized } = fakeClient({
      version,
      resources: { cpu: 4, memory: 8, disk: 64 },
    })
    const { provider } = providerOf({ client, bundlePath: b.path, stored: 'inst-9' })
    try {
      expect(
        await provider.resize({
          target: TARGET,
          shape: { vcpus: 4, memoryGb: 16 },
          diskGb: 30,
        }),
      ).toBe('restarted')
      expect(resized).toEqual([{ id: 'inst-9', memory: 16 }])
    } finally {
      cleanup()
    }
  })

  it('answers absent for a session with no instance, without asking agent37', async () => {
    const { bundle: b, cleanup } = bundle()
    const version = await agent37BundleVersionOf(b.path)
    const { client, resized } = fakeClient({ version })
    const { provider } = providerOf({ client, bundlePath: b.path, stored: null })
    try {
      expect(await provider.resize({ target: TARGET, shape: { vcpus: 4, memoryGb: 8 } })).toBe(
        'absent',
      )
      expect(resized).toEqual([])
    } finally {
      cleanup()
    }
  })
})

const refusingClient = (failure: Error): Agent37Client => {
  const { client } = fakeClient({ version: 'unused' })
  return {
    ...client,
    create: async () => {
      throw failure
    },
  }
}

const wakeFailureOf = async (failure: Error): Promise<SandboxUnavailableError> => {
  const { bundle: b, cleanup } = bundle()
  const { provider } = providerOf({ client: refusingClient(failure), bundlePath: b.path })
  try {
    const waking = provider.wake({ target: TARGET, signal: new AbortController().signal })
    const caught = await waking.catch((error: unknown) => error)
    expect(caught).toBeInstanceOf(SandboxUnavailableError)
    return caught as SandboxUnavailableError
  } finally {
    cleanup()
  }
}

describe('Agent37SandboxProvider.wake capacity', () => {
  it('reads an instance limit as the next step, without the session id or the http status', async () => {
    const failure = await wakeFailureOf(
      new Agent37Error({
        status: 409,
        code: 'instance_limit_reached',
        retryable: false,
        detail: 'instance limit reached: 4 of 4 instances',
      }),
    )
    expect(failure.message).toStartWith(
      'Agent37 is at its instance limit. Archive a few sessions or raise your Agent37 tier, then retry.',
    )
    expect(failure.message).not.toContain('pod-1')
    expect(failure.message).not.toContain('409')
    expect(failure.message).not.toContain('instance_limit_reached')
  })

  it('reads a capacity refusal as retrying in a minute', async () => {
    const failure = await wakeFailureOf(
      new Agent37Error({ status: 409, code: 'capacity_unavailable', retryable: false }),
    )
    expect(failure.message).toStartWith(
      'Agent37 has no capacity for this sandbox right now. Retry in a minute.',
    )
  })

  it('keeps the session id and agent37 text for any other failure', async () => {
    const failure = await wakeFailureOf(
      new Agent37Error({ status: 500, code: 'internal', retryable: false }),
    )
    expect(failure.message).toStartWith(
      'sandbox for pod-1 is unavailable: agent37 refused the call: 500 internal',
    )
  })
})

describe('Agent37SandboxProvider.wake size', () => {
  it('creates a new instance at the shape of the requested vcpus', async () => {
    const { bundle: b, cleanup } = bundle()
    const version = await agent37BundleVersionOf(b.path)
    const { client, creates } = fakeClient({ version })
    const { provider } = providerOf({ client, bundlePath: b.path })
    try {
      await provider.wake({ target: TARGET, signal: new AbortController().signal, vcpus: 4 })
      expect(creates[0]?.resources).toEqual({ cpu: 4, memory: 8, disk: 20 })
    } finally {
      cleanup()
    }
  })

  it('creates a new instance at the requested disk, over the template one', async () => {
    const { bundle: b, cleanup } = bundle()
    const version = await agent37BundleVersionOf(b.path)
    const { client, creates } = fakeClient({ version })
    const { provider } = providerOf({ client, bundlePath: b.path })
    try {
      await provider.wake({ target: TARGET, signal: new AbortController().signal, diskGb: 60 })
      expect(creates[0]?.resources).toEqual({
        cpu: ENV.resources.cpu,
        memory: ENV.resources.memory,
        disk: 60,
      })
    } finally {
      cleanup()
    }
  })

  it('leaves the shape to the template when no vcpus is asked for', async () => {
    const { bundle: b, cleanup } = bundle()
    const version = await agent37BundleVersionOf(b.path)
    const { client, creates } = fakeClient({ version })
    const { provider } = providerOf({ client, bundlePath: b.path })
    try {
      await provider.wake({ target: TARGET, signal: new AbortController().signal })
      expect(creates[0]?.resources).toEqual(ENV.resources)
    } finally {
      cleanup()
    }
  })

  it("reports the instance's real cpu on the endpoint so the runtime records the applied size", async () => {
    const { bundle: b, cleanup } = bundle()
    const version = await agent37BundleVersionOf(b.path)
    const { client } = fakeClient({
      version,
      get: async ({ id }) => ({
        id,
        status: 'running',
        url: `https://${id}.agent37.app`,
        resources: { cpu: 4, memory: 16, disk: 20 },
      }),
    })
    const { provider } = providerOf({ client, bundlePath: b.path, stored: 'inst-9' })
    try {
      const endpoint = await provider.wake({ target: TARGET, signal: new AbortController().signal })
      expect(endpoint.vcpus).toBe(4)
    } finally {
      cleanup()
    }
  })
})
