import { describe, expect, it } from 'bun:test'

import { useAtlasHome } from './descend-fixture'
import { ECloudSandboxState } from '../cloud-bridge'
import { liftToCloud } from '../lift'
import { CLOUD_THREAD, fakeBridge } from './fixture'
import { harness } from './lift-fixture'

describe('gating the context archive on whether the sandbox already has it', () => {
  it('skips capturing and uploading when the sandbox resumed from its snapshot', async () => {
    useAtlasHome()
    let captureCalls = 0
    const bridge = fakeBridge({
      sandbox: {
        url: 'https://sandbox.example/resumed',
        token: 'sandbox-token',
        state: ECloudSandboxState.Running,
        created: false,
        driveName: 'atlas-drive-x',
      },
    })
    const test = harness({
      bridge,
      captureContext: async () => {
        captureCalls += 1
        return Buffer.from('a fake tar.gz')
      },
    })

    const lifted = await liftToCloud(test.args)

    expect(lifted.ok).toBe(true)
    expect(captureCalls).toBe(0)
    expect(test.bridge.contextPuts).toEqual([])
    expect(test.bridge.trail).toEqual(['sandbox', 'put-transcript', 'attach'])
  })

  it('captures and uploads when the sandbox was created fresh', async () => {
    useAtlasHome()
    const archive = Buffer.from('a fake tar.gz')
    const test = harness({ captureContext: async () => archive })

    const lifted = await liftToCloud(test.args)

    expect(lifted.ok).toBe(true)
    expect(test.bridge.contextPuts).toEqual([{ threadId: CLOUD_THREAD, archive }])
  })
})
