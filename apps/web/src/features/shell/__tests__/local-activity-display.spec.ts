import { expect, it } from 'bun:test'

import { localSummary } from '@/features/desktop/__tests__/local-thread-fixture'
import { localThreadOf, withLocalThreads } from '@/features/desktop/local-thread'
import { ELocalActivityState, type LocalThread } from '@/features/desktop/local-thread-wire'

import { shellEntriesOf } from '../load-shell-entries'
import { EThreadStatus, isUnread, isWorking, threadStatusOf } from '../thread-status'
import { sessionOf, threadOf } from './fixtures'

const unavailable = (): LocalThread => {
  const { status, readSeq, ...base } = localSummary
  return { ...base, activityState: ELocalActivityState.Unavailable, reason: 'Activity unsupported' }
}

it('keeps unavailable local activity separate from known unread and healthy Cloud activity', () => {
  const unknownCursor = localThreadOf(unavailable())
  const absentCursor = localThreadOf({ ...unavailable(), readSeq: null })
  const readCursor = localThreadOf({ ...unavailable(), readSeq: 3 })
  const cloud = threadOf({ id: 'cloud' })
  expect(unknownCursor).not.toHaveProperty('status')
  expect(unknownCursor.localAvailability).not.toHaveProperty('readSeq')
  expect(threadStatusOf(unknownCursor)).toBe(EThreadStatus.Unavailable)
  expect(isWorking(unknownCursor)).toBe(false)
  expect(isUnread({ thread: unknownCursor, active: false })).toBe(false)
  expect(isUnread({ thread: absentCursor, active: false })).toBe(true)
  expect(isUnread({ thread: readCursor, active: false })).toBe(false)
  expect(isUnread({ thread: absentCursor, active: true })).toBe(false)
  expect(
    isUnread({
      thread: localThreadOf({ ...unavailable(), lastAssistantSeq: null, readSeq: null }),
      active: false,
    }),
  ).toBe(false)
  expect(threadStatusOf(cloud)).toBe(EThreadStatus.Idle)
  expect(cloud).not.toHaveProperty('localAvailability')
})

it('preserves unavailable metadata and native identity through deduplication and activity overrides', () => {
  const entries = withLocalThreads({
    entries: [{ project: null, sessions: [sessionOf(threadOf({ id: 'brn_1' }))] }],
    threads: [unavailable(), localSummary],
  })
  const merged = shellEntriesOf({
    entries: withLocalThreads({ entries, threads: [unavailable()] }),
    created: [],
    overrides: new Map([['brn_1', { activity: { working: true }, at: 1, pending: true }]]),
  })
  const local = merged[0]?.sessions[0]?.mainThread
  expect(merged[0]?.sessions).toHaveLength(1)
  expect(local).toMatchObject({
    id: 'brn_1',
    runner: 'local',
    head: 3,
    title: 'Host title',
    localAvailability: {
      activityState: 'unavailable',
      lastAssistantSeq: 3,
      reason: 'Activity unsupported',
    },
  })
  expect(local).not.toHaveProperty('status')
})
