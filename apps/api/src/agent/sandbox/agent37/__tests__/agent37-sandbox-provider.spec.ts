import { describe, expect, it } from 'bun:test'

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ESandboxProvider } from '@dltech/atlas-protocol'
import { daemonToken } from '@dltech/atlas-protocol/engine'

import type { SandboxTarget } from '../../sandbox-provider'
import type {
  Agent37Client,
  Agent37CreateArgs,
  Agent37ExecArgs,
  Agent37ResizeArgs,
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
}) => {
  const creates: Agent37CreateArgs[] = []
  const execs: Agent37ExecArgs[] = []
  const slept: string[] = []
  const resized: Agent37ResizeArgs[] = []
  const removed: string[] = []
  const client: Agent37Client = {
    create: async (body) => {
      creates.push(body)
      return { id: 'inst-1', status: 'running', url: 'https://inst-1.agent37.app' }
    },
    get:
      args.get ?? (async ({ id }) => ({ id, status: 'running', url: `https://${id}.agent37.app` })),
    list: args.list ?? (async () => ({ data: [] })),
    remove: async ({ id }) => {
      removed.push(id)
    },
    sleep: async ({ id }) => {
      slept.push(id)
    },
    resize: async (body) => {
      resized.push(body)
      return { id: body.id, status: 'running', url: `https://${body.id}.agent37.app` }
    },
    exec: async (body) => {
      execs.push(body)
      return { exit_code: 0, stdout: '', stderr: '', truncated: false }
    },
    probe: async () => ({ status: 200, body: args.version }),
    signedUrl: async ({ id, port }) => `https://${id}-${port}.agent37.app/?a37_token=a37`,
  }
  return { client, creates, execs, slept, resized, removed }
}

const providerOf = (args: {
  client: Agent37Client
  bundlePath: string
  stored?: string | null
}) => {
  const remembered: Array<{ podSessionId: string; instanceId: string }> = []
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
    },
  })
  return { provider, remembered }
}

describe('Agent37SandboxProvider.wake', () => {
  it('creates the instance once, waits for the daemon and returns the signed port URL', async () => {
    const { bundle: b, cleanup } = bundle()
    const version = await agent37BundleVersionOf(b.path)
    const { client, creates, execs } = fakeClient({ version })
    const { provider, remembered } = providerOf({ client, bundlePath: b.path })
    try {
      const endpoint = await provider.wake({ target: TARGET, signal: new AbortController().signal })

      expect(creates).toHaveLength(1)
      expect(execs).toHaveLength(0)
      expect(remembered).toEqual([{ podSessionId: 'pod-1', instanceId: 'inst-1' }])
      expect(endpoint.url).toBe('wss://inst-1-3000.agent37.app/?a37_token=a37')
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

  it('wakes a known instance without creating another and without an exec', async () => {
    const { bundle: b, cleanup } = bundle()
    const version = await agent37BundleVersionOf(b.path)
    const { client, creates, execs } = fakeClient({ version })
    const { provider } = providerOf({ client, bundlePath: b.path, stored: 'inst-9' })
    try {
      const endpoint = await provider.wake({ target: TARGET, signal: new AbortController().signal })

      expect(creates).toHaveLength(0)
      expect(execs).toHaveLength(0)
      expect(endpoint.url).toContain('inst-9-3000')
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
      expect(creates[0]?.env.PORT).toBe('3000')
      expect(creates[0]?.env.DAEMON_TOKEN).toBeString()
    } finally {
      cleanup()
    }
  })
})

describe('Agent37SandboxProvider.resize', () => {
  it('resizes the remembered instance to the nearest vm shape, leaving disk alone', async () => {
    const { bundle: b, cleanup } = bundle()
    const version = await agent37BundleVersionOf(b.path)
    const { client, resized } = fakeClient({ version })
    const { provider } = providerOf({ client, bundlePath: b.path, stored: 'inst-9' })
    try {
      await provider.resize({ target: TARGET, vcpus: 3 })
      expect(resized).toEqual([{ id: 'inst-9', cpu: 4, memory: 8 }])
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
      expect(await provider.resize({ target: TARGET, vcpus: 4 })).toBe('absent')
      expect(resized).toEqual([])
    } finally {
      cleanup()
    }
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

describe('Agent37SandboxProvider.delete', () => {
  it('removes the remembered instance', async () => {
    const { bundle: b, cleanup } = bundle()
    const version = await agent37BundleVersionOf(b.path)
    const { client, removed } = fakeClient({ version })
    const { provider } = providerOf({ client, bundlePath: b.path, stored: 'inst-9' })
    try {
      await provider.delete({ target: TARGET })
      expect(removed).toEqual(['inst-9'])
    } finally {
      cleanup()
    }
  })

  it('is a success when the pod has no instance left', async () => {
    const { bundle: b, cleanup } = bundle()
    const version = await agent37BundleVersionOf(b.path)
    const { client, removed } = fakeClient({ version })
    const { provider } = providerOf({ client, bundlePath: b.path, stored: null })
    try {
      await expect(provider.delete({ target: TARGET })).resolves.toBeUndefined()
      expect(removed).toEqual([])
    } finally {
      cleanup()
    }
  })
})

describe('Agent37SandboxProvider.list', () => {
  it('walks every page and keeps only the instances this host created for a pod', async () => {
    const asked: Array<{ cursor?: string }> = []
    const list: Agent37Client['list'] = async (params = {}) => {
      asked.push(params)
      if (params.cursor === undefined)
        return {
          data: [
            {
              id: 'inst-a',
              status: 'running',
              url: 'https://inst-a.agent37.app',
              metadata: { atlasPodSessionId: 'pod-a' },
              created: 1_000,
            },
            {
              id: 'inst-x',
              status: 'running',
              url: 'https://inst-x.agent37.app',
              metadata: { other: 'x' },
            },
          ],
          next: 'page-2',
        }
      return {
        data: [
          {
            id: 'inst-c',
            status: 'sleeping',
            url: 'https://inst-c.agent37.app',
            metadata: { atlasPodSessionId: 'pod-c' },
            created: 2_000,
          },
        ],
      }
    }
    const { client } = fakeClient({ version: 'unused', list })
    const { provider } = providerOf({ client, bundlePath: '/unused/daemon.js' })

    const listed = await provider.list({
      credentials: { provider: ESandboxProvider.Agent37, apiKey: 'sk_live_test' },
    })

    expect(listed).toEqual([
      { sandboxSessionId: 'pod-a', running: true, createdAt: 1_000_000 },
      { sandboxSessionId: 'pod-c', running: false, createdAt: 2_000_000 },
    ])
    expect(asked).toEqual([{}, { cursor: 'page-2' }])
  })
})

describe('Agent37SandboxProvider.stop', () => {
  it('sleeps the remembered instance', async () => {
    const { bundle: b, cleanup } = bundle()
    const version = await agent37BundleVersionOf(b.path)
    const { client, slept } = fakeClient({ version })
    const { provider } = providerOf({ client, bundlePath: b.path, stored: 'inst-9' })
    try {
      await provider.stop({ target: TARGET })
      expect(slept).toEqual(['inst-9'])
    } finally {
      cleanup()
    }
  })
})
