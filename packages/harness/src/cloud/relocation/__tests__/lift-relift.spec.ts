import { describe, expect, it } from 'bun:test'

import { EExecutionLocation } from '@dltech/atlas-core'

import { useAtlasHome } from './descend-fixture'
import { liftToCloud } from '../lift'
import { CLOUD_THREAD, fakeBridge } from './fixture'
import { harness } from './lift-fixture'

const cloudMarkers = (events: readonly { type: string }[]): number =>
  events.filter(
    (event) => event.type === 'location-changed' && (event as { to?: string }).to === 'cloud',
  ).length

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

  /**
   * The re-lift's marker lands locally, after the archive sealed: the transcript the cloud serves —
   * and the one the operator reads while lifted — ends at the descend's marker, with no `to: cloud`
   * event of its own. The divider has to come from placement, not from an event that is not there.
   */
  it('ships an archive whose cloud transcript holds no second cloud marker on a re-lift', async () => {
    useAtlasHome()
    const bridge = fakeBridge()
    const test = harness({ bridge })

    const first = await liftToCloud(test.args)
    expect(first.ok).toBe(true)

    // Home again: the descend's marker is the last location event the local log holds.
    await test.localThreads.chooseExecutionLocation({
      threadId: CLOUD_THREAD,
      location: EExecutionLocation.Host,
    })
    await test.localLog.append({
      threadId: CLOUD_THREAD,
      runId: test.args.ids.nextRunId(),
      drafts: [
        {
          type: 'location-changed',
          from: EExecutionLocation.Cloud,
          to: EExecutionLocation.Host,
          cwd: '/work',
        },
        { type: 'user-said', text: 'back up it goes' },
      ],
    })

    const second = await liftToCloud(test.args)
    expect(second.ok).toBe(true)

    // The re-lift's own marker is in the local log — appended after the archive sealed.
    const local = test.localLog.peek({ threadId: CLOUD_THREAD })
    expect(cloudMarkers(local)).toBe(2)

    // The archive shipped once per lift; the second put already happened when the re-lift's own
    // marker landed above, so the shipped transcript cannot carry it.
    expect(bridge.transcriptPuts).toHaveLength(2)
  })
})
