import { describe, expect, it } from 'bun:test'

import type { WireThread } from '@dltech/atlas-wire/web'

import type { Schedule } from '@/features/threads/data/thread-signals'

import { applyActivityOverrides, createActivityOverrides } from '../activity-overrides'
import { sessionOf, threadOf } from './fixtures'

const IDLE: NonNullable<WireThread['status']> = {
  working: false,
  awaiting: null,
  lastOutcome: null,
  podState: 'running',
  lastAssistantSeq: 0,
  readSeq: null,
}

function harness() {
  let clock = 1_000
  const tasks: Array<() => void> = []
  const schedule: Schedule = ({ run }) => {
    tasks.push(run)
    return () => undefined
  }
  const store = createActivityOverrides({ now: () => clock, schedule })
  return {
    store,
    tick: (ms: number) => (clock += ms),
    expire: () => {
      for (const run of tasks.splice(0)) run()
    },
  }
}

const statusOf = (args: { thread: WireThread; overrides: ReturnType<typeof harness>['store'] }) =>
  applyActivityOverrides({
    entries: [{ project: null, sessions: [sessionOf(args.thread)] }],
    overrides: args.overrides.snapshot(),
  })[0]?.sessions[0]?.mainThread.status

describe('activity overrides', () => {
  it('patches a listed thread with a pushed activity', () => {
    const { store } = harness()
    const thread = threadOf({ id: 'thr-1', status: IDLE })

    store.record({
      threadId: 'thr-1',
      activity: { working: true, awaiting: 'input', lastOutcome: null },
    })

    expect(statusOf({ thread, overrides: store })).toMatchObject({
      working: true,
      awaiting: 'input',
      podState: 'running',
    })
  })

  it('patches a teammate nested under a session', () => {
    const { store } = harness()
    const teammate = sessionOf(threadOf({ id: 'thr-mate', status: IDLE }))
    store.record({
      threadId: 'thr-mate',
      activity: { working: true, awaiting: null, lastOutcome: null },
    })

    const [entry] = applyActivityOverrides({
      entries: [
        {
          project: null,
          sessions: [sessionOf(threadOf({ id: 'thr-1', status: IDLE }), [teammate])],
        },
      ],
      overrides: store.snapshot(),
    })

    expect(entry?.sessions[0]?.teammates[0]?.mainThread.status?.working).toBe(true)
  })

  it('marks a sent thread working until the pending window expires', () => {
    const { store, expire } = harness()
    const thread = threadOf({ id: 'thr-1', status: IDLE })

    store.markWorking('thr-1')
    expect(statusOf({ thread, overrides: store })?.working).toBe(true)
    expire()

    expect(statusOf({ thread, overrides: store })?.working).toBe(false)
  })

  it('leaves a booting pod showing as starting rather than working', () => {
    const { store } = harness()
    const thread = threadOf({
      id: 'thr-1',
      status: { ...IDLE, podState: 'booting' },
    })

    store.markWorking('thr-1')

    expect(statusOf({ thread, overrides: store })?.working).toBe(false)
  })

  it('lets a pushed idle replace a pending working mark', () => {
    const { store } = harness()
    const thread = threadOf({ id: 'thr-1', status: IDLE })

    store.markWorking('thr-1')
    store.record({
      threadId: 'thr-1',
      activity: { working: false, awaiting: null, lastOutcome: 'completed' },
    })

    expect(statusOf({ thread, overrides: store })).toMatchObject({
      working: false,
      lastOutcome: 'completed',
    })
  })

  it('drops pushed activity once a list loaded after it arrives', () => {
    const { store, tick } = harness()
    store.record({
      threadId: 'thr-1',
      activity: { working: true, awaiting: null, lastOutcome: null },
    })
    const recordedAt = store.snapshot().get('thr-1')?.at ?? 0

    store.settleBefore(recordedAt)
    expect(store.snapshot().size).toBe(1)
    tick(10)
    store.settleBefore(recordedAt + 10)

    expect(store.snapshot().size).toBe(0)
  })

  it('reverts only the mark it placed', () => {
    const { store } = harness()
    const mark = store.markWorking('thr-1')
    store.record({
      threadId: 'thr-1',
      activity: { working: false, awaiting: null, lastOutcome: 'failed' },
    })

    if (mark !== undefined) store.revert({ threadId: 'thr-1', override: mark })

    expect(store.snapshot().get('thr-1')?.activity.lastOutcome).toBe('failed')
  })
})
