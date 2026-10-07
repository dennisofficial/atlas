import { describe, expect, it } from 'bun:test'

import { toThreadId } from '@dltech/atlas-core'

import type { BridgeDriver } from '../local-cloud-bootstrap'
import { createLocalCloudBridge } from '../local-cloud-bridge'
import { sandboxNameFor } from '../sandbox-names'
import type { VercelSandboxConfig } from '../vercel-driver'

const threadId = toThreadId('thread-destroy')

const config: VercelSandboxConfig = {
  credentials: { token: 'vt', teamId: 'team', projectId: 'proj' },
  image: 'atlas-sandbox:test',
}

const bridgeWith = ({ vercel }: { vercel: () => VercelSandboxConfig }) => {
  const seen: Parameters<BridgeDriver['destroy']>[0][] = []
  const driver: Pick<BridgeDriver, 'destroy'> = {
    destroy: async (destroyArgs) => {
      seen.push(destroyArgs)
    },
  }
  const bridge = createLocalCloudBridge({
    vercel,
    attachmentToken: () => 'tok',
    driverWith: () => driver as BridgeDriver,
  })
  return { bridge, seen }
}

const unconfigured = (): VercelSandboxConfig => {
  throw new Error('no Vercel credentials')
}

describe('bridge destroy forwarding', () => {
  it('forwards the expected sandbox session as the driver fence', async () => {
    const { bridge, seen } = bridgeWith({ vercel: () => config })

    await bridge.sandboxes.destroy({ threadId, expectedSandboxSessionId: 'session-1' })

    expect(seen).toEqual([{ name: sandboxNameFor({ threadId }), threadId, sessionId: 'session-1' }])
  })

  it('leaves the driver unfenced when no session is expected', async () => {
    const { bridge, seen } = bridgeWith({ vercel: () => config })

    await bridge.sandboxes.destroy({ threadId })

    expect(seen).toEqual([{ name: sandboxNameFor({ threadId }), threadId, sessionId: undefined }])
  })

  it('stays silent without credentials when unfenced', async () => {
    const { bridge, seen } = bridgeWith({ vercel: unconfigured })

    await expect(bridge.sandboxes.destroy({ threadId })).resolves.toBeUndefined()

    expect(seen).toEqual([])
  })

  it('throws without credentials when fenced so the cleanup warning stays', async () => {
    const { bridge, seen } = bridgeWith({ vercel: unconfigured })

    await expect(bridge.sandboxes.destroy({ threadId, expectedSandboxSessionId: 'session-1' })).rejects.toThrow(
      'no Vercel credentials',
    )

    expect(seen).toEqual([])
  })
})
