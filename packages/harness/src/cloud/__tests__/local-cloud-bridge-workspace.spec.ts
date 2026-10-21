import { describe, expect, it } from 'vitest'

import { toThreadId } from '@dltech/atlas-core'

import type { BridgeDriver } from '../local-cloud-bootstrap'
import { createLocalCloudBridge } from '../local-cloud-bridge'
import { ECloudSandboxState } from '../sandbox-client'
import type { VercelSandboxConfig } from '@dltech/atlas-wire'

const threadId = toThreadId('thread-workspace')

const config: VercelSandboxConfig = {
  credentials: { token: 'vt', teamId: 'team', projectId: 'proj' },
  image: 'atlas-sandbox:test',
}

const bridgeSeeing = (args: { environment?: Record<string, string> }) => {
  const seen: (Record<string, string> | undefined)[] = []
  const driver: BridgeDriver = {
    inspect: async () => undefined,
    createOrResume: async (createArgs) => {
      seen.push(createArgs.environment)
      return {
        sessionId: 'session-1',
        url: 'https://sb.vercel.run',
        state: ECloudSandboxState.Running,
        created: true,
        driveName: 'drive-1',
        token: 'tok',
      }
    },
    writeBootstrapFileToSandbox: async () => {},
    writeBootstrapFile: async () => {},
    readResources: async () => ({}),
    updateResources: async () => {},
    destroy: async () => {},
  }
  const bridge = createLocalCloudBridge({
    vercel: () => config,
    attachmentToken: () => 'tok',
    driverWith: () => driver,
    ...(args.environment === undefined ? {} : { environment: () => args.environment ?? {} }),
  })
  return { bridge, seen }
}

describe('createLocalCloudBridge sandbox environment', () => {
  it('forwards the operator environment as the sandbox boot environment', async () => {
    const { bridge, seen } = bridgeSeeing({ environment: { ATLAS_CLASSIFIER_MODE: 'nudge' } })

    await bridge.sandboxes.create({ threadId, projectId: null })

    expect(seen).toEqual([{ ATLAS_CLASSIFIER_MODE: 'nudge' }])
  })

  it('passes no environment at all when there is nothing to say', async () => {
    const { bridge, seen } = bridgeSeeing({})

    await bridge.sandboxes.create({ threadId, projectId: null })

    expect(seen).toEqual([undefined])
  })
})
