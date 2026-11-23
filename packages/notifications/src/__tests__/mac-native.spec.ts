import { describe, expect, it } from 'bun:test'

import { EMacPush, groupsToRemove, macPushOf } from '../client/mac-native'

describe('macPushOf', () => {
  it('reads a clear push', () => {
    expect(macPushOf({ aps: { 'content-available': 1 }, clearSessionId: 'session-1' })).toEqual({
      kind: EMacPush.Clear,
      sessionId: 'session-1',
    })
  })

  it('reads an alert push', () => {
    expect(
      macPushOf({ aps: { alert: { title: 'Fix', body: 'Done' } }, sessionId: 'session-1', seq: 7 }),
    ).toEqual({ kind: EMacPush.Notification, sessionId: 'session-1', seq: 7 })
  })

  it('prefers the clear when a payload carries both keys', () => {
    expect(macPushOf({ clearSessionId: 'session-2', sessionId: 'session-1', seq: 7 })).toEqual({
      kind: EMacPush.Clear,
      sessionId: 'session-2',
    })
  })

  it('reads nothing from a payload it does not know', () => {
    expect(macPushOf(null)).toBeNull()
    expect(macPushOf('session-1')).toBeNull()
    expect(macPushOf({ sessionId: '' })).toBeNull()
    expect(macPushOf({ sessionId: 'session-1', seq: 'seven' })).toBeNull()
  })
})

describe('groupsToRemove', () => {
  const history = [{ groupId: 'session-1' }, {}, { groupId: 'session-2' }, { groupId: 'session-1' }]

  it('removes the group of one session', () => {
    expect(groupsToRemove({ history, sessionId: 'session-1' })).toEqual(['session-1'])
  })

  it('removes the groups of the read sessions', () => {
    expect(groupsToRemove({ history, readSessionIds: ['session-2'] })).toEqual(['session-2'])
    expect(groupsToRemove({ history, readSessionIds: ['session-1', 'session-2'] })).toEqual([
      'session-1',
      'session-2',
    ])
  })

  it('removes nothing for a session that has no group', () => {
    expect(groupsToRemove({ history, sessionId: 'session-3' })).toEqual([])
    expect(groupsToRemove({ history: [{}, {}], readSessionIds: ['session-1'] })).toEqual([])
    expect(groupsToRemove({ history })).toEqual([])
  })
})
