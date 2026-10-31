import { describe, expect, it, spyOn } from 'bun:test'
import { EThreadLiveFrame } from '@dltech/atlas-wire/web'

import { emptyLiveList } from '../live-list'
import { createLiveListPublisher } from '../live-list-publisher'
import type { AppliedLiveFrame } from '../live-stream'
import type { ProjectThreads } from '../thread-partition'
import { threadOf } from './fixtures'

function appliedOf(args: { rev: number; snapshot?: boolean }): AppliedLiveFrame {
  const row = {
    sessionId: 'ses_1',
    projectId: null,
    managedBySessionId: null,
    sortAt: '2026-10-31',
    rev: args.rev,
    thread: threadOf({ id: 'thr_1', title: `rev ${args.rev}` }),
  }
  return {
    at: args.rev,
    state: { ...emptyLiveList(), ready: true, rows: new Map([[row.thread.id, row]]) },
    frame: args.snapshot
      ? { type: EThreadLiveFrame.Snapshot, rows: [row], projects: [] }
      : { type: EThreadLiveFrame.Upsert, row },
  }
}

const latestTitle = (entries: ProjectThreads[]) => entries.at(-1)?.sessions[0]?.mainThread.title

describe('live list cache publisher', () => {
  it('publishes every Cloud snapshot and patch immediately without a local source', () => {
    const titles: (string | undefined)[] = []
    const publisher = createLiveListPublisher({
      publish: ({ entries }) => titles.push(latestTitle(entries)),
    })
    publisher.apply(appliedOf({ rev: 1, snapshot: true }))
    expect(titles).toEqual(['rev 1'])
    publisher.apply(appliedOf({ rev: 2 }))
    expect(titles).toEqual(['rev 1', 'rev 2'])
    publisher.apply(appliedOf({ rev: 4, snapshot: true }))
    expect(titles).toEqual(['rev 1', 'rev 2', 'rev 4'])
  })

  it('preserves the applied Cloud update and performs no HTTP reads', () => {
    const fetch = spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected request'))
    const applied = appliedOf({ rev: 1, snapshot: true })
    const updates: { applied: AppliedLiveFrame; entries: ProjectThreads[] }[] = []
    try {
      const publisher = createLiveListPublisher({ publish: (update) => updates.push(update) })
      publisher.apply(applied)
      expect(updates[0]?.applied).toBe(applied)
      expect(updates[0]?.entries).toMatchObject([
        { project: null, sessions: [{ mainThread: { id: 'thr_1', title: 'rev 1' } }] },
      ])
      expect(updates[0]?.entries[0]?.sessions[0]?.mainThread).not.toHaveProperty(
        'localAvailability',
      )
      expect(fetch).not.toHaveBeenCalled()
    } finally {
      fetch.mockRestore()
    }
  })

  it('does not write after the subscriber unmounts or becomes hidden', () => {
    const titles: (string | undefined)[] = []
    const publisher = createLiveListPublisher({
      publish: ({ entries }) => titles.push(latestTitle(entries)),
    })
    publisher.apply(appliedOf({ rev: 1, snapshot: true }))
    publisher.stop()
    publisher.apply(appliedOf({ rev: 2 }))
    publisher.apply(appliedOf({ rev: 4, snapshot: true }))
    expect(titles).toEqual(['rev 1'])
  })
})
