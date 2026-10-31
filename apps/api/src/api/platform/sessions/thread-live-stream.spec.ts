import { EThreadLiveFrame, type Project, type ThreadLiveFrame } from '@dltech/atlas-wire'
import { EShipBehavior } from '@dltech/atlas-wire/web'
import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { afterEach, beforeEach, describe, expect, it, jest } from 'bun:test'
import { seedThreadRow, seedUsers, USER_A } from '../../../../test/session-seed'
import { DrainStateService } from '../health/drain-state.service'
import { liveSnapshot } from './live-snapshot'
import { InProcessThreadSignalBus, type ThreadChangedSignal } from './thread-signal.bus'
import { attachLiveStream } from './thread-live-stream'
import { THREAD_STREAM_HEARTBEAT_INTERVAL_MS, THREAD_STREAM_LIFETIME_MS } from './thread-stream'
import { ThreadSignalsService } from './thread-signals.service'

const until = async (ready: () => boolean): Promise<void> => {
  const deadline = Date.now() + 5000
  while (!ready()) {
    if (Date.now() > deadline) throw new Error('timed out waiting for the stream')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

const PROJECT: Project = {
  id: 'prj_1',
  name: 'atlas',
  repo: 'dennisofficial/atlas',
  baseBranch: 'main',
  additionalRepos: [],
  description: '',
  shipBehavior: EShipBehavior.OpenPullRequest,
  createdAt: '2026-09-15T00:00:00.000Z',
  updatedAt: '2026-09-15T00:00:00.000Z',
}

describe('attachLiveStream', () => {
  useTestDatabase()

  let signals: ThreadSignalsService

  beforeEach(async () => {
    await seedUsers(USER_A)
    signals = new ThreadSignalsService(new DrainStateService(), new InProcessThreadSignalBus())
  })

  afterEach(() => {
    signals.closeAll()
  })

  const changedOf = async (threadId: string): Promise<ThreadChangedSignal> => {
    const seen: ThreadChangedSignal[] = []
    const unwatch = signals.watchThreadChanges({
      userId: USER_A,
      onChanged: (signal) => seen.push(signal),
    })
    signals.threadChanged({ threadId })
    await signals.changesSettled()
    unwatch()
    const signal = seen.at(-1)
    if (signal === undefined) throw new Error(`no change signal for ${threadId}`)
    return signal
  }

  it('streams snapshot then live upserts with no gap and no duplicate', async () => {
    await seedThreadRow({ id: 'thr-1', userId: USER_A, title: 'first' })
    await db.orm.public.Project.create({
      id: PROJECT.id,
      name: PROJECT.name,
      repo: PROJECT.repo,
      baseBranch: PROJECT.baseBranch,
      additionalRepos: [],
      ownerUserId: USER_A,
      createdById: USER_A,
      createdAt: new Date(PROJECT.createdAt),
      updatedAt: new Date(PROJECT.updatedAt),
    })
    const frames: ThreadLiveFrame[] = []
    let gate = Promise.resolve()
    const readSnapshot = async () => {
      const held = gate
      await held
      return liveSnapshot({ userId: USER_A })
    }
    attachLiveStream({
      signals,
      userId: USER_A,
      readSnapshot,
      sink: { push: (frame) => frames.push(frame), close: () => {} },
    })

    gate = (async () => {
      await signals.publish(await changedOf('thr-1'))
    })()
    await gate
    await until(() => frames.some((frame) => frame.type === EThreadLiveFrame.Snapshot))

    const snapshot = frames.find((frame) => frame.type === EThreadLiveFrame.Snapshot)
    expect(snapshot).toBeDefined()
    if (snapshot?.type !== EThreadLiveFrame.Snapshot) throw new Error('unreachable')
    expect(snapshot.rows.map((row) => row.thread.id)).toEqual(['thr-1'])
    expect(snapshot.projects).toEqual([PROJECT])

    const upserts = frames.filter((frame) => frame.type === EThreadLiveFrame.Upsert)
    const snapshotRev = snapshot.rows[0]?.rev
    const upsertRev = upserts[0]?.type === EThreadLiveFrame.Upsert ? upserts[0].row.rev : undefined
    if (upserts.length === 0) {
      expect(snapshotRev).toBe(1)
    } else {
      expect(upserts).toHaveLength(1)
      expect(upsertRev).toBe(1)
      expect(snapshotRev).toBe(0)
      const snapshotIndex = frames.findIndex((frame) => frame.type === EThreadLiveFrame.Snapshot)
      expect(frames.indexOf(upserts[0] as ThreadLiveFrame)).toBeGreaterThan(snapshotIndex)
    }
  })

  it('drops a buffered row whose rev is not newer than the snapshot and forwards a newer one', async () => {
    await seedThreadRow({ id: 'thr-2', userId: USER_A, title: 'second' })
    const frames: ThreadLiveFrame[] = []
    const first = await changedOf('thr-2')
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    attachLiveStream({
      signals,
      userId: USER_A,
      readSnapshot: async () => {
        await gate
        return liveSnapshot({ userId: USER_A })
      },
      sink: { push: (frame) => frames.push(frame), close: () => {} },
    })
    await signals.publish(first)
    release()
    await until(() => frames.some((frame) => frame.type === EThreadLiveFrame.Snapshot))
    expect(frames.filter((frame) => frame.type === EThreadLiveFrame.Upsert)).toEqual([])

    await signals.publish(await changedOf('thr-2'))
    await until(() => frames.some((frame) => frame.type === EThreadLiveFrame.Upsert))
    const upserts = frames.filter((frame) => frame.type === EThreadLiveFrame.Upsert)
    expect(upserts).toHaveLength(1)
    expect(upserts[0]?.type === EThreadLiveFrame.Upsert && upserts[0].row.thread.id).toBe('thr-2')
  })

  it('does not upsert side threads', async () => {
    await seedThreadRow({ id: 'thr-main', userId: USER_A })
    const main = await changedOf('thr-main')
    const side: ThreadChangedSignal = {
      ...main,
      threadId: 'thr-side',
      session: { ...main.session, mainThreadId: 'thr-main' },
    }
    const frames: ThreadLiveFrame[] = []
    attachLiveStream({
      signals,
      userId: USER_A,
      readSnapshot: () => liveSnapshot({ userId: USER_A }),
      sink: { push: (frame) => frames.push(frame), close: () => {} },
    })
    await until(() => frames.some((frame) => frame.type === EThreadLiveFrame.Snapshot))

    await signals.publish(side)
    await until(() => frames.length > 0)
    expect(frames.filter((frame) => frame.type === EThreadLiveFrame.Upsert)).toEqual([])
  })

  it('forwards project upsert and remove frames', async () => {
    await seedThreadRow({ id: 'thr-3', userId: USER_A })
    const frames: ThreadLiveFrame[] = []
    attachLiveStream({
      signals,
      userId: USER_A,
      readSnapshot: () => liveSnapshot({ userId: USER_A }),
      sink: { push: (frame) => frames.push(frame), close: () => {} },
    })
    await until(() => frames.some((frame) => frame.type === EThreadLiveFrame.Snapshot))

    await signals.publish({ userId: USER_A, project: PROJECT })
    await signals.publish({ userId: USER_A, projectId: PROJECT.id, removed: true })
    await until(() => frames.length >= 3)

    expect(frames.slice(1)).toEqual([
      { type: EThreadLiveFrame.ProjectUpsert, project: PROJECT },
      { type: EThreadLiveFrame.ProjectRemove, projectId: PROJECT.id },
    ])
  })

  it('resyncs and closes when the buffer overflows before the snapshot', async () => {
    const frames: ThreadLiveFrame[] = []
    let closed = false
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    attachLiveStream({
      signals,
      userId: USER_A,
      readSnapshot: async () => {
        await gate
        return liveSnapshot({ userId: USER_A })
      },
      sink: {
        push: (frame) => frames.push(frame),
        close: () => {
          closed = true
        },
      },
    })
    for (let index = 0; index < 1001; index += 1) {
      await signals.publish({ userId: USER_A, project: { ...PROJECT, id: `prj_${index}` } })
    }
    release()
    await until(() => closed)

    expect(closed).toBe(true)
    expect(frames).toEqual([{ type: EThreadLiveFrame.Resync, reason: 'overflow' }])
  })

  it('closes live watches on drain', async () => {
    const drain = new DrainStateService()
    const draining = new ThreadSignalsService(drain, new InProcessThreadSignalBus())
    await seedThreadRow({ id: 'thr-4', userId: USER_A })
    let closed = false
    attachLiveStream({
      signals: draining,
      userId: USER_A,
      readSnapshot: () => liveSnapshot({ userId: USER_A }),
      sink: { push: () => {}, close: () => (closed = true) },
    })
    drain.beginDrain()
    await until(() => closed)
    expect(closed).toBe(true)
  })

  it('closes when the snapshot read fails', async () => {
    let closed = false
    attachLiveStream({
      signals,
      userId: USER_A,
      readSnapshot: async () => {
        throw new Error('db down')
      },
      sink: { push: () => {}, close: () => (closed = true) },
    })
    await until(() => closed)
    expect(closed).toBe(true)
  })

  it('beats on the heartbeat interval and closes at the lifetime cap', async () => {
    jest.useFakeTimers()
    try {
      const frames: ThreadLiveFrame[] = []
      let closed = false
      const detach = attachLiveStream({
        signals,
        userId: USER_A,
        readSnapshot: async () => ({ rows: [], projects: [] }),
        sink: {
          push: (frame) => frames.push(frame),
          close: () => {
            closed = true
          },
        },
      })
      await Promise.resolve()
      jest.advanceTimersByTime(THREAD_STREAM_HEARTBEAT_INTERVAL_MS)
      expect(frames.some((frame) => frame.type === EThreadLiveFrame.Heartbeat)).toBe(true)
      jest.advanceTimersByTime(THREAD_STREAM_LIFETIME_MS)
      expect(closed).toBe(true)
      detach()
    } finally {
      jest.useRealTimers()
    }
  })
})
