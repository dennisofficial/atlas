import { describe, expect, it } from 'bun:test'

import { presentedNotificationOf, readDismissalIdsOf, sessionIdOfData } from '../notification-data'

describe('sessionIdOfData', () => {
  it('reads the session an Expo push names', () => {
    expect(sessionIdOfData({ sessionId: 'session-1', seq: 7 })).toBe('session-1')
  })

  it('opens no session for a routine notice', () => {
    expect(
      sessionIdOfData({ sessionId: 'routine-rtn-1', seq: 0, routineId: 'rtn-1' }),
    ).toBeUndefined()
  })

  it('ignores data that names no session', () => {
    expect(sessionIdOfData({ seq: 7 })).toBeUndefined()
    expect(sessionIdOfData({ sessionId: '' })).toBeUndefined()
    expect(sessionIdOfData(undefined)).toBeUndefined()
    expect(sessionIdOfData('session-1')).toBeUndefined()
  })
})

describe('presentedNotificationOf', () => {
  it('reads the identifier, the session and the read marker a presented notification carries', () => {
    expect(
      presentedNotificationOf({
        identifier: 'notification-1',
        data: { sessionId: 'session-1', seq: 7 },
      }),
    ).toEqual({ identifier: 'notification-1', sessionId: 'session-1', seq: 7 })
  })

  it('reads nothing from a notification without a seq', () => {
    expect(
      presentedNotificationOf({ identifier: 'notification-1', data: { sessionId: 'session-1' } }),
    ).toBeNull()
  })
})

describe('readDismissalIdsOf', () => {
  const presented = [
    { identifier: 'notification-1', sessionId: 'session-1', seq: 7 },
    { identifier: 'notification-2', sessionId: 'session-2', seq: 3 },
    { identifier: 'notification-3', sessionId: 'session-3', seq: 4 },
  ]

  it('dismisses the notifications whose session is read up to their seq', () => {
    const readSeqs = new Map([
      ['session-1', 7],
      ['session-2', 2],
      ['session-3', 9],
    ])

    expect(readDismissalIdsOf({ presented, readSeqs })).toEqual([
      'notification-1',
      'notification-3',
    ])
  })

  it('keeps a notification whose session is not in the list', () => {
    expect(readDismissalIdsOf({ presented, readSeqs: new Map() })).toEqual([])
  })
})
