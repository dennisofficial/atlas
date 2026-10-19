import { describe, expect, it } from 'bun:test'

import { toThreadId } from '@dltech/atlas-core'
import type { VercelSandboxConfig } from '@dltech/atlas-wire'

import { EResizeApplies } from '../cloud-bridge'
import type { BridgeDriver } from '../local-cloud-bootstrap'
import { createLocalCloudBridge } from '../local-cloud-bridge'
import { sandboxNameFor } from '../sandbox-names'

const threadId = toThreadId('thread-resize')

const config: VercelSandboxConfig = {
  credentials: { token: 'vt', teamId: 'team', projectId: 'proj' },
  image: 'atlas-sandbox:test',
}

describe('createLocalCloudBridge resize', () => {
  it('resizes through the driver and reports it applies at the next wake', async () => {
    const seen: Parameters<BridgeDriver['updateResources']>[0][] = []
    const driver: Pick<BridgeDriver, 'updateResources'> = {
      updateResources: async (resize) => {
        seen.push(resize)
      },
    }
    const bridge = createLocalCloudBridge({
      vercel: () => config,
      attachmentToken: () => 'tok',
      driverWith: () => driver as BridgeDriver,
    })

    const answer = await bridge.sandboxes.updateResources({ threadId, vcpus: 4 })

    expect(answer).toEqual({ appliesAt: EResizeApplies.Restart })
    expect(seen).toEqual([{ name: sandboxNameFor({ threadId }), vcpus: 4 }])
  })
})
