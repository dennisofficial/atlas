import { describe, expect, it } from 'vitest'
import { toThreadId } from '@dltech/atlas-core'
import type { SandboxPlacement, VercelSandboxConfig } from '@dltech/atlas-wire'

import { type BridgeDriver } from '../local-cloud-bootstrap'
import { createLocalCloudBridge } from '../local-cloud-bridge'

const threadId = toThreadId('thread-dev-pin')
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

const driverPlacing = (placement: Partial<SandboxPlacement>): BridgeDriver => ({
  inspect: async () => undefined,
  createOrResume: async () => ({
    sessionId: 'session-1',
    url: 'https://sb.vercel.run',
    state: 'running',
    created: true,
    token: 'serve-token',
    ...placement,
  }),
  writeBootstrapFileToSandbox: async () => undefined,
  writeBootstrapFile: async () => undefined,
  readResources: async () => ({}),
  updateResources: async () => {},
  destroy: async () => {},
})

const registeredVersionOf = async (args: {
  config: Partial<VercelSandboxConfig>
  placement: Partial<SandboxPlacement>
}): Promise<unknown[]> => {
  const registered: unknown[] = []
  const bridge = createLocalCloudBridge({
    vercel: () => ({
      credentials: { token: 'test', teamId: 'team', projectId: 'project' },
      image: 'atlas-sandbox:latest',
      ...args.config,
    }),
    attachmentToken: () => 'serve-token',
    registration: () => ({}),
    sendRegistration: ({ registration }) => {
      registered.push(registration.serveVersion)
    },
    driverWith: () => driverPlacing(args.placement),
  })
  await bridge.sandboxes.create({ threadId, projectId: null })
  await tick()
  await tick()
  return registered
}

describe('cloud sandbox registration serve pin', () => {
  it('registers the dev pin the placement was provisioned against', async () => {
    const registered = await registeredVersionOf({
      config: { devServe: async () => ({ version: 'dev-bbbbbbbbbbbb', path: '/x', sha256: 'f', bytes: 1 }) },
      placement: { serveVersion: 'dev-bbbbbbbbbbbb' },
    })

    expect(registered).toEqual(['dev-bbbbbbbbbbbb'])
  })

  it('falls back to the configured release pin when the placement names none', async () => {
    const registered = await registeredVersionOf({
      config: { serveVersion: '1.4.2' },
      placement: {},
    })

    expect(registered).toEqual(['1.4.2'])
  })

  it('registers no pin when neither the placement nor the config has one', async () => {
    const registered = await registeredVersionOf({ config: {}, placement: {} })

    expect(registered).toEqual([undefined])
  })
})
