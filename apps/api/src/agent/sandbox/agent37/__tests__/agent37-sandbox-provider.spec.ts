import { describe, expect, it } from 'bun:test'

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ESandboxProvider } from '@dltech/atlas-protocol'
import { daemonToken } from '@dltech/atlas-protocol/engine'

import type { SandboxTarget } from '../../sandbox-provider'
import type { Agent37Client, Agent37CreateArgs, Agent37ExecArgs } from '../agent37-client'
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

const fakeClient = (args: { version: string; get?: Agent37Client['get'] }) => {
  const creates: Agent37CreateArgs[] = []
  const execs: Agent37ExecArgs[] = []
  const slept: string[] = []
  const client: Agent37Client = {
    create: async (body) => {
      creates.push(body)
      return { id: 'inst-1', status: 'running', url: 'https://inst-1.agent37.app' }
    },
    get:
      args.get ?? (async ({ id }) => ({ id, status: 'running', url: `https://${id}.agent37.app` })),
    list: async () => ({ data: [] }),
    remove: async () => undefined,
    sleep: async ({ id }) => {
      slept.push(id)
    },
    exec: async (body) => {
      execs.push(body)
      return { exit_code: 0, stdout: '', stderr: '', truncated: false }
    },
    probe: async () => ({ status: 200, body: args.version }),
    signedUrl: async ({ id, port }) => `https://${id}-${port}.agent37.app/?a37_token=a37`,
  }
  return { client, creates, execs, slept }
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
