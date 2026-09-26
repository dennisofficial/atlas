import { describe, expect, it } from 'bun:test'

import { CloudError } from '@dltech/atlas-harness'

import { useAtlasHome } from './descend-fixture'
import { ELiftFault, liftToCloud } from '../lift'
import { CLOUD_THREAD, fakeBridge } from './fixture'
import { harness } from './lift-fixture'

describe('the workspace a lift carries', () => {
  it('reads a 413 as the patch being too large, keeping the advice the API gave', async () => {
    useAtlasHome()
    const bridge = fakeBridge({
      createFails: new CloudError({
        status: 413,
        message:
          'The Atlas Cloud API answered POST /v1/sandboxes with 413: the uncommitted patch is 7.2 MiB, over the 5 MiB ceiling — commit or discard some work before lifting.',
      }),
    })
    const test = harness({ bridge })

    const lifted = await liftToCloud(test.args)
    if (lifted.ok) throw new Error('expected the lift to fail')

    expect(lifted.fault).toBe(ELiftFault.PatchTooLarge)
    expect(lifted.detail).toContain('commit or discard some work')
  })

  it('sends no workspace when there is no repository behind the session', async () => {
    useAtlasHome()
    const test = harness({ capture: async () => null })

    const lifted = await liftToCloud(test.args)

    expect(lifted.ok).toBe(true)
    expect(test.bridge.created).toEqual([{ threadId: CLOUD_THREAD, workspace: null }])
  })

  it('says so in the transition notice when no repository came with it', async () => {
    useAtlasHome()
    const test = harness({ capture: async () => null })

    await liftToCloud(test.args)

    const notice = test.localLog
      .peek({ threadId: CLOUD_THREAD })
      .find((event) => event.type === 'context-loaded')
    if (notice === undefined || notice.type !== 'context-loaded') {
      throw new Error('expected a transition notice in the local log')
    }

    expect(notice.content).toContain('no git repository')
  })
})
