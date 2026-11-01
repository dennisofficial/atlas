import { describe, expect, it } from 'bun:test'

import { EThreadStatus, isUnread, threadStatusOf } from '../thread-status'
import { THREAD_ROW_STATES } from './thread-row-states'

describe('THREAD_ROW_STATES', () => {
  it('maps each fixture to its intended status and unread flag', () => {
    for (const { thread, expected, unread } of THREAD_ROW_STATES) {
      expect(threadStatusOf(thread)).toBe(expected)
      expect(isUnread({ thread, active: false })).toBe(unread)
    }
  })

  it('covers every run status without substituting legacy PR statuses', () => {
    const covered = new Set(THREAD_ROW_STATES.map((state) => state.expected))
    expect(covered).toEqual(
      new Set([
        EThreadStatus.Running,
        EThreadStatus.Awaiting,
        EThreadStatus.Starting,
        EThreadStatus.Failed,
        EThreadStatus.Idle,
        EThreadStatus.Parked,
      ]),
    )
  })
})
