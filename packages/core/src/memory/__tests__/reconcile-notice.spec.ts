import { describe, expect, it } from 'bun:test'

import { EIndexPressure } from '../index-pressure'
import { reconcileNoticeOf } from '../reconcile-notice'

const entries = [
  { scope: 'project', name: 'newer', updatedAt: '2026-11-20T10:00:00.000Z', descriptionChars: 90 },
  { scope: 'global', name: 'older', updatedAt: '2026-10-21T10:00:00.000Z', descriptionChars: 230 },
]

describe('reconcileNoticeOf', () => {
  it('asks for a reconcile now past the reconcile limit', () => {
    const text = reconcileNoticeOf({
      pressure: EIndexPressure.Reconcile,
      indexChars: 23_860,
      entries,
    })
    expect(text).toContain('The memory index is now 23860 characters.')
    expect(text).toContain('Reconcile the memory now')
  })

  it('asks for a reconcile when the task lets you past the advisory limit', () => {
    const text = reconcileNoticeOf({
      pressure: EIndexPressure.Advisory,
      indexChars: 13_000,
      entries,
    })
    expect(text).toContain('when the current task lets you')
    expect(text).not.toContain('Reconcile the memory now')
  })

  it('lists the memories oldest first with their dates and flags long descriptions', () => {
    const text = reconcileNoticeOf({
      pressure: EIndexPressure.Advisory,
      indexChars: 13_000,
      entries,
    })
    const lines = text.split('\n').filter((line) => line.startsWith('- 2026'))
    expect(lines).toEqual([
      '- 2026-10-21 global older (description 230 characters)',
      '- 2026-11-20 project newer',
    ])
  })
})
