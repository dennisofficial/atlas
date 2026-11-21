import { describe, expect, it } from 'bun:test'

import { ESandboxProvider } from '@dltech/atlas-protocol'

import type { SandboxTarget } from '../../sandbox-provider'
import { Agent37Error, type Agent37Client, type Agent37Instance } from '../agent37-client'
import type { Agent37Env } from '../agent37-instances'
import { Agent37SandboxProvider } from '../agent37-sandbox-provider'

const ENV: Agent37Env = {
  apiKey: 'sk_live_test',
  template: 'atlas-sandbox@3',
  resources: { cpu: 2, memory: 4, disk: 64 },
}

const TARGET: SandboxTarget = {
  sandboxSessionId: 'pod-1',
  credentials: { provider: ESandboxProvider.Agent37, apiKey: 'sk_live_test' },
}

const instanceOf = (args: {
  id: string
  podSessionId?: string
  status?: Agent37Instance['status']
}): Agent37Instance => ({
  id: args.id,
  status: args.status ?? 'stopped',
  url: `https://${args.id}.agent37.app`,
  ...(args.podSessionId === undefined
    ? {}
    : { metadata: { atlasPodSessionId: args.podSessionId } }),
})

const fakeClient = (
  args: {
    instances?: readonly Agent37Instance[]
    get?: Agent37Client['get']
    remove?: Agent37Client['remove']
    list?: Agent37Client['list']
  } = {},
) => {
  const removed: string[] = []
  const client: Agent37Client = {
    create: async () => {
      throw new Error('unused')
    },
    get:
      args.get ??
      (async ({ id }) =>
        args.instances?.find((instance) => instance.id === id) ?? {
          id,
          status: 'stopped',
          url: `https://${id}.agent37.app`,
        }),
    list: args.list ?? (async () => ({ data: [...(args.instances ?? [])] })),
    remove: async ({ id }) => {
      await args.remove?.({ id })
      removed.push(id)
    },
    sleep: async () => undefined,
    start: async ({ id }) => ({ id, status: 'running' }),
    resize: async (body) => ({ id: body.id, status: 'running', url: '' }),
    exec: async () => ({ exit_code: 0, stdout: '', stderr: '', truncated: false }),
    probe: async () => ({ status: 200, body: '' }),
    signedUrl: async ({ id, port }) => `https://${id}-${port}.agent37.app/?a37_token=a37`,
    usage: async () => ({ from: '', to: '' }),
    events: async () => ({ from: '', to: '', events: [] }),
  }
  return { client, removed }
}

const providerOf = (args: { client: Agent37Client; stored?: string | null }) => {
  let stored = args.stored ?? null
  const forgotten: string[] = []
  const provider = new Agent37SandboxProvider({
    env: ENV,
    daemonBundle: { path: '/unused/daemon.js' },
    daemonBundleUrl: 'https://api.byatlas.io/agent/daemon/bundle',
    daemonSecret: 'secret',
    client: args.client,
    instances: {
      find: async ({ podSessionId }) => (podSessionId === TARGET.sandboxSessionId ? stored : null),
      remember: async (params) => {
        stored = params.instanceId
      },
      forget: async ({ podSessionId }) => {
        forgotten.push(podSessionId)
        stored = null
      },
      seedStatus: async () => undefined,
    },
  })
  return { provider, forgotten, stored: () => stored }
}

describe('Agent37SandboxProvider.delete', () => {
  it('removes the remembered instance and forgets it', async () => {
    const { client, removed } = fakeClient({})
    const { provider, forgotten, stored } = providerOf({ client, stored: 'inst-9' })

    await provider.delete({ target: TARGET })

    expect(removed).toEqual(['inst-9'])
    expect(forgotten).toEqual(['pod-1'])
    expect(stored()).toBeNull()
  })

  it('is a success when the pod has no instance left', async () => {
    const { client, removed } = fakeClient({})
    const { provider } = providerOf({ client, stored: null })

    await expect(provider.delete({ target: TARGET })).resolves.toBeUndefined()
    expect(removed).toEqual([])
  })

  it('removes an orphan the session no longer remembers, found by its pod key', async () => {
    const { client, removed } = fakeClient({
      instances: [instanceOf({ id: 'inst-orphan', podSessionId: 'pod-1' })],
    })
    const { provider } = providerOf({ client, stored: null })

    await provider.delete({ target: TARGET })

    expect(removed).toEqual(['inst-orphan'])
  })

  it('removes every instance of the pod, the remembered one and its duplicates', async () => {
    const { client, removed } = fakeClient({
      instances: [
        instanceOf({ id: 'inst-a', podSessionId: 'pod-1' }),
        instanceOf({ id: 'inst-b', podSessionId: 'pod-1' }),
        instanceOf({ id: 'inst-other', podSessionId: 'pod-2' }),
      ],
    })
    const { provider } = providerOf({ client, stored: 'inst-a' })

    await provider.delete({ target: TARGET })

    expect(removed.sort()).toEqual(['inst-a', 'inst-b'])
  })

  it('leaves a running instance alone, because a live pod is not storage', async () => {
    const { client, removed } = fakeClient({
      instances: [instanceOf({ id: 'inst-live', podSessionId: 'pod-1', status: 'running' })],
    })
    const { provider } = providerOf({ client, stored: 'inst-live' })

    await provider.delete({ target: TARGET })

    expect(removed).toEqual([])
  })

  it('treats a 404 from the delete as success, so a second delete still succeeds', async () => {
    const { client, removed } = fakeClient({
      instances: [instanceOf({ id: 'inst-gone', podSessionId: 'pod-1' })],
      remove: async () => {
        throw new Agent37Error({ status: 404, code: 'not_found', retryable: false })
      },
    })
    const { provider } = providerOf({ client, stored: 'inst-gone' })

    await expect(provider.delete({ target: TARGET })).resolves.toBeUndefined()
    await expect(provider.delete({ target: TARGET })).resolves.toBeUndefined()
    expect(removed).toEqual([])
  })

  it('treats an instance that vanished before the get as gone', async () => {
    const { client, removed } = fakeClient({
      get: async () => {
        throw new Agent37Error({ status: 404, code: 'not_found', retryable: false })
      },
    })
    const { provider } = providerOf({ client, stored: 'inst-9' })

    await expect(provider.delete({ target: TARGET })).resolves.toBeUndefined()
    expect(removed).toEqual([])
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
            instanceOf({ id: 'inst-a', podSessionId: 'pod-a', status: 'running' }),
            instanceOf({ id: 'inst-x' }),
          ],
          next: 'page-2',
        }
      return { data: [instanceOf({ id: 'inst-c', podSessionId: 'pod-c' })] }
    }
    const { client } = fakeClient({ list })
    const { provider } = providerOf({ client })

    const listed = await provider.list({
      credentials: { provider: ESandboxProvider.Agent37, apiKey: 'sk_live_test' },
    })

    expect(listed.map((listing) => listing.sandboxSessionId)).toEqual(['pod-a', 'pod-c'])
    expect(listed[0]?.running).toBe(true)
    expect(asked).toEqual([{}, { cursor: 'page-2' }])
  })
})

describe('Agent37SandboxProvider.stop', () => {
  it('sleeps the remembered instance', async () => {
    const slept: string[] = []
    const { client } = fakeClient({})
    const { provider } = providerOf({
      client: { ...client, sleep: async ({ id }) => void slept.push(id) },
      stored: 'inst-9',
    })

    await provider.stop({ target: TARGET })

    expect(slept).toEqual(['inst-9'])
  })
})
