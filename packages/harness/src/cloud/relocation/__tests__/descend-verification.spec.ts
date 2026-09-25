import { describe, expect, it } from 'bun:test'

import { EExecutionLocation, toRunId } from '@dltech/atlas-core'

import { CHILD, descend, localHome, said, seedCloud } from './descend-fixture'
import { CLOUD_THREAD, fakeBridge } from './fixture'

describe('a descend whose local log lands short', () => {
  it('aborts before the flip and leaves the sandbox standing', async () => {
    const bridge = fakeBridge()
    await seedCloud(bridge, ['one', 'two', 'three'])
    const home = localHome({ events: [said({ seq: 1, text: 'one' })] })
    const honestHead = home.log.head
    home.log.head = async ({ threadId }) => {
      const head = await honestHead({ threadId })
      return threadId === CLOUD_THREAD ? head - 1 : head
    }

    await expect(descend({ bridge, home })).rejects.toThrow('came back short')

    expect(
      (await home.threads.find({ threadId: CLOUD_THREAD }))?.executionLocation,
    ).toBe(EExecutionLocation.Cloud)
    expect(
      (await bridge.threads.find({ threadId: CLOUD_THREAD }))?.executionLocation,
    ).toBe(EExecutionLocation.Cloud)
    expect(bridge.destroyed).toEqual([])
  })

  it('aborts when a child log lands short, before any flip or teardown', async () => {
    const bridge = fakeBridge()
    await seedCloud(bridge, ['parent says'])
    await seedCloud(bridge, ['child says', 'more from the child'], {
      threadId: CHILD,
      spawnedBy: CLOUD_THREAD,
    })
    const home = localHome({ events: [said({ seq: 1, text: 'parent says' })] })
    await home.threads.createWithFirstEvents({
      threadId: CHILD,
      runId: toRunId('run_child_seed'),
      drafts: [{ type: 'user-said' as const, text: 'child says' }],
      agent: { spawnedBy: CLOUD_THREAD, type: 'explore' },
    })
    const honestHead = home.log.head
    home.log.head = async ({ threadId }) => {
      const head = await honestHead({ threadId })
      return threadId === CHILD ? head - 1 : head
    }

    await expect(descend({ bridge, home })).rejects.toThrow('came back short')

    expect(
      (await home.threads.find({ threadId: CLOUD_THREAD }))?.executionLocation,
    ).toBe(EExecutionLocation.Cloud)
    expect(bridge.destroyed).toEqual([])
  })
})

describe('the title on descend', () => {
  it('adopts the title the thread earned in the cloud when coming home', async () => {
    const bridge = fakeBridge()
    await seedCloud(bridge, ['one'])
    await bridge.threads.rename({ threadId: CLOUD_THREAD, title: 'titled while away' })
    const home = localHome({ events: [said({ seq: 1, text: 'one' })] })

    await descend({ bridge, home })

    expect((await home.threads.find({ threadId: CLOUD_THREAD }))?.title).toBe('titled while away')
  })

  it('keeps the local title when the cloud never set one', async () => {
    const bridge = fakeBridge()
    await seedCloud(bridge, ['one'])
    const home = localHome({ events: [said({ seq: 1, text: 'one' })] })
    await home.threads.rename({ threadId: CLOUD_THREAD, title: 'named at home' })

    await descend({ bridge, home })

    expect((await home.threads.find({ threadId: CLOUD_THREAD }))?.title).toBe('named at home')
  })
})
