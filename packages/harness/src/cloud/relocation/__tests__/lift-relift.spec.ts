import { describe, expect, it } from 'bun:test'

import { EExecutionLocation } from '@dltech/atlas-core'

import { useAtlasHome } from './descend-fixture'
import { liftToCloud } from '../lift'
import { eventsInArchive } from './fake-transcript'
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
   * The lift hands its `to: cloud` marker to the sandbox on the RestoreTranscript wire op, and the
   * sandbox pins it onto its own log — skipping the pin when the log already ends at that marker.
   * The local log never holds a lift marker, so the shipped archive carries none; on a re-lift
   * against the same sandbox the restore-time pin is idempotent and one marker survives.
   */
  it('pins one cloud marker on the sandbox log and ships none in the transcript on a re-lift', async () => {
    useAtlasHome()
    const bridge = fakeBridge()
    const test = harness({ bridge })

    const first = await liftToCloud(test.args)
    expect(first.ok).toBe(true)

    const afterFirst = bridge.log.peek({ threadId: CLOUD_THREAD })
    expect(cloudMarkers(afterFirst)).toBe(1)
    expect(afterFirst.at(-1)?.type).toBe('location-changed')
    expect(cloudMarkers(test.localLog.peek({ threadId: CLOUD_THREAD }))).toBe(0)

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

    // The sandbox log already ended at the first lift's marker, so the re-lift's pin is skipped.
    expect(cloudMarkers(bridge.log.peek({ threadId: CLOUD_THREAD }))).toBe(1)
    expect(cloudMarkers(test.localLog.peek({ threadId: CLOUD_THREAD }))).toBe(0)

    expect(bridge.transcriptPuts).toHaveLength(2)
    const put = bridge.transcriptPuts.at(-1)
    if (put === undefined) throw new Error('the re-lift shipped no transcript archive')
    expect(cloudMarkers(await eventsInArchive(put.archive))).toBe(0)
  })
})
