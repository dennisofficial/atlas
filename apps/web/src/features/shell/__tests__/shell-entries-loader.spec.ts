import { expect, it } from 'bun:test'

import { localSummary } from '@/features/desktop/__tests__/local-thread-fixture'
import { ELocalActivityState, type LocalThread } from '@/features/desktop/local-thread-wire'
import { withLocalThreads } from '@/features/desktop/local-thread'

import { createLocalEntriesLoader, shellEntriesOf } from '../load-shell-entries'
import { sessionOf, threadOf } from './fixtures'

it('retains the last local snapshot after failure without resurrecting Cloud mirrors', async () => {
  let fail = false
  const failure = new Error('Host unavailable')
  const load = createLocalEntriesLoader({
    load: async () => {
      if (fail) throw failure
      return [localSummary]
    },
  })
  await load()
  fail = true
  const retained = await load()
  const entries = withLocalThreads({
    entries: [
      {
        project: null,
        sessions: [
          sessionOf(threadOf({ id: 'brn_1', title: 'Cloud mirror' })),
          sessionOf(threadOf({ id: 'cloud', title: 'Fresh streamed patch' })),
        ],
      },
    ],
    threads: retained.threads,
  })
  expect(entries[0]?.sessions.map((session) => session.mainThread.title)).toEqual([
    'Fresh streamed patch',
    'Host title',
  ])
  expect(retained.error).toBe(failure)
})

it('forgets a retained local snapshot only after a successful empty collection', async () => {
  let phase = 0
  const load = createLocalEntriesLoader({
    load: async () => {
      if (phase === 2) throw new Error('Host unavailable')
      return phase === 0 ? [localSummary] : []
    },
  })
  await load()
  phase = 1
  expect((await load()).threads).toEqual([])
  phase = 2
  expect((await load()).threads).toEqual([])
})

it('preserves unavailable metadata across refresh and protects it from Cloud activity overrides', async () => {
  const { status, ...base } = localSummary
  const unavailable = {
    ...base,
    activityState: ELocalActivityState.Unavailable,
    reason: 'Unsupported',
  } satisfies LocalThread
  const load = createLocalEntriesLoader({
    load: async () => [unavailable, { ...localSummary, threadId: 'healthy' }],
  })
  const local = await load()
  const entries = withLocalThreads({ entries: [], threads: local.threads })
  const merged = shellEntriesOf({
    entries,
    created: [],
    overrides: new Map([['brn_1', { activity: { working: true }, at: 1, pending: true }]]),
  })
  expect(merged[0]?.sessions[0]?.mainThread).not.toHaveProperty('status')
  expect(merged[0]?.sessions[0]?.mainThread).toMatchObject({
    localAvailability: { activityState: 'unavailable', reason: 'Unsupported', readSeq: 1 },
  })
  expect(merged[0]?.sessions[1]?.mainThread.status).toEqual(localSummary.status)
  const refreshed = await load()
  expect(refreshed.threads[0]).toEqual(unavailable)
})
