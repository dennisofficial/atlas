import { describe, expect, it } from 'bun:test'

import { toRunId } from '@dltech/atlas-core'

import { cloudArchiveOf, descend, useDescendHome } from './descend-fixture'
import { CLOUD_THREAD, fakeBridge } from './fixture'

const said = (text: string) => ({ type: 'user-said' as const, text })

describe('the title on descend', () => {
  it('adopts the title the thread earned in the cloud when coming home', async () => {
    const home = useDescendHome()
    const archive = await cloudArchiveOf([
      { title: 'titled while away', drafts: [said('one')] },
    ])
    const bridge = fakeBridge({ archive })

    await descend({ bridge, home })

    expect((await home.threads.find({ threadId: CLOUD_THREAD }))?.title).toBe('titled while away')
  })

  it('keeps the local title when the cloud never set one', async () => {
    const home = useDescendHome()
    await home.threads.createWithFirstEvents({
      threadId: CLOUD_THREAD,
      runId: toRunId('run_stale_local'),
      drafts: [said('one')],
      workspace: '/work',
      title: 'named at home',
    })
    const archive = await cloudArchiveOf([{ drafts: [said('one')] }])
    const bridge = fakeBridge({ archive })

    await descend({ bridge, home })

    expect((await home.threads.find({ threadId: CLOUD_THREAD }))?.title).toBeUndefined()
  })
})
