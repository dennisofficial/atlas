import { describe, expect, it } from 'bun:test'

import { EPodResizeProbe } from '@dltech/atlas-core'
import { ESandboxProvider } from '@dltech/atlas-protocol'

import type { SandboxTarget } from '../../sandbox-provider'
import type { Agent37Client, Agent37Instance } from '../agent37-client'
import { Agent37SandboxProvider } from '../agent37-sandbox-provider'

const TARGET: SandboxTarget = {
  sandboxSessionId: 'pod-1',
  credentials: { provider: ESandboxProvider.Agent37, apiKey: 'sk_live_test' },
}

const providerOf = (args: {
  instance: Omit<Agent37Instance, 'id' | 'url'> | null
  clientGet?: Agent37Client['get']
}) => {
  const fetched: string[] = []
  const client = {
    get:
      args.clientGet ??
      (async ({ id }) => {
        fetched.push(id)
        if (args.instance === null) throw new Error('no such instance')
        return { id, url: `https://${id}.agent37.app`, ...args.instance }
      }),
  } as unknown as Agent37Client
  const provider = new Agent37SandboxProvider({
    env: {
      apiKey: 'sk_live_test',
      template: 'atlas-sandbox@3',
      resources: { cpu: 2, memory: 4, disk: 20 },
    },
    daemonBundle: { path: '/nonexistent/daemon.js' },
    daemonBundleUrl: 'https://api.byatlas.io/agent/daemon/bundle',
    daemonSecret: 'secret',
    client,
    instances: {
      find: async () => 'inst-1',
      remember: async () => {},
      forget: async () => {},
      seedStatus: async () => {},
    },
  })
  return { provider, fetched }
}

const SHAPE = { vcpus: 8, memoryGb: 32 }

describe('Agent37SandboxProvider.resizeState', () => {
  it('reads an instance that is still being updated', async () => {
    const { provider, fetched } = providerOf({
      instance: { status: 'updating', resources: { cpu: 2, memory: 4, disk: 20 } },
    })

    expect(await provider.resizeState({ target: TARGET, shape: SHAPE })).toBe(
      EPodResizeProbe.Updating,
    )
    expect(fetched).toEqual(['inst-1'])
  })

  it('reads the shape of an instance that already has the target resources', async () => {
    const { provider } = providerOf({
      instance: { status: 'running', resources: { cpu: 8, memory: 32, disk: 20 } },
    })

    expect(await provider.resizeState({ target: TARGET, shape: SHAPE })).toBe(
      EPodResizeProbe.AtTarget,
    )
  })

  it('reports an instance that is still at another shape', async () => {
    const { provider } = providerOf({
      instance: { status: 'running', resources: { cpu: 4, memory: 16, disk: 20 } },
    })

    expect(await provider.resizeState({ target: TARGET, shape: SHAPE })).toBe(
      EPodResizeProbe.NotAtTarget,
    )
  })

  it('answers unknown when the provider cannot read the instance', async () => {
    const { provider } = providerOf({
      instance: null,
      clientGet: async () => {
        throw new Error('the api is down')
      },
    })

    expect(await provider.resizeState({ target: TARGET, shape: SHAPE })).toBe(
      EPodResizeProbe.Unknown,
    )
  })
})
