import { describe, expect, it } from 'bun:test'

import { useAtlasHome } from './descend-fixture'
import { liftToCloud } from '../lift'
import { CLOUD_THREAD, fakeBridge } from './fixture'
import { harness } from './lift-fixture'

describe('lifting a thread that was lifted before', () => {
  it('persists the title the thread earned at home onto the local row on flip', async () => {
    useAtlasHome()
    const bridge = fakeBridge()
    const test = harness({ bridge, title: 'the title it earned at home' })

    const lifted = await liftToCloud(test.args)

    expect(lifted.ok).toBe(true)
    expect(test.localThreads.renames).toEqual([
      { threadId: CLOUD_THREAD, title: 'the title it earned at home' },
    ])
    expect((await test.localThreads.find({ threadId: CLOUD_THREAD }))?.title).toBe(
      'the title it earned at home',
    )
  })

  it('leaves the local title alone when lifting without one', async () => {
    useAtlasHome()
    const bridge = fakeBridge()
    const test = harness({ bridge, title: null })

    const lifted = await liftToCloud(test.args)

    expect(lifted.ok).toBe(true)
    expect(test.localThreads.renames).toEqual([])
  })
})
