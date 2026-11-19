import { describe, expect, it } from 'bun:test'

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ESandboxProvider } from '@dltech/atlas-protocol'
import { daemonToken } from '@dltech/atlas-protocol/engine'

import type { SandboxTarget } from '../../sandbox-provider'
import type { Agent37Client, Agent37CreateArgs, Agent37ExecArgs } from '../agent37-client'
import { agent37InstanceNameOf, type Agent37Env } from '../agent37-instances'
import { Agent37SandboxProvider } from '../agent37-sandbox-provider'

const ENV: Agent37Env = {
  apiKey: 'sk_live_test',
  template: 'atlas-sandbox@3',
  resources: { cpu: 2, memory: 4, disk: 20 },
}

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

const fakeClient = (args: { stored?: string | null } = {}) => {
  const creates: Agent37CreateArgs[] = []
  const execs: Agent37ExecArgs[] = []
  const slept: string[] = []
  const client: Agent37Client = {
    create: async (body) => {
      creates.push(body)
      return { id: 'inst-1', status: 'running', url: 'https://inst-1.agent37.app' }
    },
    get: async ({ id }) => ({ id, status: 'running', url: `https://${id}.agent37.app` }),
    list: async () => ({ data: [] }),
    remove: async () => undefined,
    sleep: async ({ id }) => {
      slept.push(id)
    },
    exec: async (body) => {
      execs.push(body)
      if (body.command.includes('grep -qx atlas-daemon')) {
        return { exit_code: 0, stdout: 'atlas-daemon\n', stderr: '', truncated: false }
      }
      return { exit_code: 0, stdout: '', stderr: '', truncated: false }
    },
    signedUrl: async ({ id }) => `https://${id}-3000.agent37.app/?a37_token=a37`,
  }
  return { client, creates, execs, slept, stored: args.stored }
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
  it('creates the instance once, launches the daemon and returns the signed port URL', async () => {
    const { bundle: b, cleanup } = bundle()
    const { client, creates } = fakeClient()
    const { provider, remembered } = providerOf({ client, bundlePath: b.path })

    const endpoint = await provider.wake({ target: TARGET, signal: new AbortController().signal })

    expect(creates).toHaveLength(1)
    expect(remembered).toEqual([{ podSessionId: 'pod-1', instanceId: 'inst-1' }])
    expect(endpoint.url).toBe('wss://inst-1-3000.agent37.app/?a37_token=a37')
    expect(endpoint.sandboxName).toBe(agent37InstanceNameOf('pod-1'))
    expect(endpoint.token).toBe(
      daemonToken({ secret: 'secret', sandboxName: agent37InstanceNameOf('pod-1') }),
    )
    cleanup()
  })

  it('starts the daemon with a background exec, which returns at once', async () => {
    const { bundle: b, cleanup } = bundle()
    const { client, execs } = fakeClient()
    const { provider } = providerOf({ client, bundlePath: b.path })

    await provider.wake({ target: TARGET, signal: new AbortController().signal })

    const launches = execs.filter((exec) => exec.command.includes('/opt/mise/shims/bun'))
    expect(launches).toHaveLength(1)
    expect(launches[0]?.background).toBe(true)
    cleanup()
  })

  it('reuses the stored instance id on a later wake instead of creating again', async () => {
    const { bundle: b, cleanup } = bundle()
    const { client, creates } = fakeClient()
    const { provider } = providerOf({ client, bundlePath: b.path, stored: 'inst-old' })

    const endpoint = await provider.wake({ target: TARGET, signal: new AbortController().signal })

    expect(creates).toHaveLength(0)
    expect(endpoint.url).toBe('wss://inst-old-3000.agent37.app/?a37_token=a37')
    cleanup()
  })

  it('refuses a Vercel target', async () => {
    const { bundle: b, cleanup } = bundle()
    const { client } = fakeClient()
    const { provider } = providerOf({ client, bundlePath: b.path })

    const failure = await provider
      .wake({
        target: {
          sandboxSessionId: 'pod-1',
          credentials: {
            provider: ESandboxProvider.Vercel,
            token: 't',
            teamId: 'x',
            projectId: 'y',
          },
        },
        signal: new AbortController().signal,
      })
      .catch((error) => error)

    expect(String(failure)).toContain('Agent37SandboxProvider cannot run a vercel sandbox')
    cleanup()
  })
})

describe('Agent37SandboxProvider.stop and keepAlive', () => {
  it('sleeps the stored instance rather than deleting it', async () => {
    const { client, slept } = fakeClient()
    const { provider } = providerOf({ client, bundlePath: '/nonexistent', stored: 'inst-9' })
    await provider.stop({ target: TARGET })
    expect(slept).toEqual(['inst-9'])
  })

  it('does nothing when no instance was ever created', async () => {
    const { client, slept, execs } = fakeClient()
    const { provider } = providerOf({ client, bundlePath: '/nonexistent' })
    await provider.stop({ target: TARGET })
    await provider.keepAlive({ target: TARGET, until: 1 })
    expect(slept).toEqual([])
    expect(execs).toEqual([])
  })

  it('touches the instance with one foreground exec, which counts as activity', async () => {
    const { client, execs } = fakeClient()
    const { provider } = providerOf({ client, bundlePath: '/nonexistent', stored: 'inst-9' })
    await provider.keepAlive({ target: TARGET, until: Date.now() + 60_000 })
    expect(execs).toEqual([{ id: 'inst-9', command: 'true' }])
  })
})
