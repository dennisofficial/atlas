import { describe, expect, it } from 'bun:test'
import { EThreadLiveFrame } from '@dltech/atlas-wire/web'

import type { LocalPod } from '@/features/desktop/desktop-wire'

import { emptyLiveList } from '../live-list'
import { createLiveListPublisher } from '../live-list-publisher'
import type { AppliedLiveFrame } from '../live-stream'
import type { ProjectThreads } from '../thread-partition'
import { threadOf } from './fixtures'

const deferred = () => {
  let resolve!: (pods: LocalPod[]) => void
  const promise = new Promise<LocalPod[]>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

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
  it('loads local pods once per snapshot and publishes the newest buffered state', async () => {
    const pending = deferred()
    const titles: (string | undefined)[] = []
    let loads = 0
    const publisher = createLiveListPublisher({
      loadPods: () => {
        loads += 1
        return pending.promise
      },
      publish: ({ entries }) => {
        titles.push(latestTitle(entries))
      },
    })
    publisher.apply(appliedOf({ rev: 1, snapshot: true }))
    publisher.apply(appliedOf({ rev: 2 }))
    expect(titles).toEqual([])
    pending.resolve([])
    await Promise.resolve()
    expect(titles).toEqual(['rev 2'])
    publisher.apply(appliedOf({ rev: 3 }))
    expect(titles).toEqual(['rev 2', 'rev 3'])
    expect(loads).toBe(1)
  })

  it('rejects a late snapshot load from a superseded stream snapshot', async () => {
    const old = deferred()
    const fresh = deferred()
    const titles: (string | undefined)[] = []
    const pending = [old, fresh]
    const publisher = createLiveListPublisher({
      loadPods: () => pending.shift()?.promise ?? Promise.resolve([]),
      publish: ({ entries }) => {
        titles.push(latestTitle(entries))
      },
    })
    publisher.apply(appliedOf({ rev: 1, snapshot: true }))
    publisher.apply(appliedOf({ rev: 4, snapshot: true }))
    fresh.resolve([])
    await Promise.resolve()
    old.resolve([])
    await Promise.resolve()
    expect(titles).toEqual(['rev 4'])
  })

  it('does not write after the subscriber unmounts or becomes hidden', async () => {
    const pending = deferred()
    let writes = 0
    const publisher = createLiveListPublisher({
      loadPods: () => pending.promise,
      publish: () => {
        writes += 1
      },
    })
    publisher.apply(appliedOf({ rev: 1, snapshot: true }))
    publisher.stop()
    pending.resolve([])
    await Promise.resolve()
    publisher.apply(appliedOf({ rev: 2 }))
    expect(writes).toBe(0)
  })
})
