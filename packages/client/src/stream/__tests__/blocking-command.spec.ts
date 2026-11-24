import { describe, expect, it } from 'bun:test'

import { ESessionStatus } from '@dltech/atlas-core'
import { ECommandState, type SessionCommandRow } from '@dltech/atlas-protocol'

import { blockingCommandOf, elapsedClockOf } from '../blocking-command'
import type { SessionSnapshot } from '../session-follower'

type Status = NonNullable<SessionSnapshot['status']>

const POSTED = '2026-11-24T16:16:17.000Z'
const CONSUMED = '2026-11-24T16:16:18.000Z'

const row = (name: string, state = ECommandState.Running): SessionCommandRow => ({
  inboxId: 105,
  name,
  postedAt: POSTED,
  state,
})

const statusWith = (args: {
  commands: readonly SessionCommandRow[]
  state?: ESessionStatus
  reason?: string
}): Status => ({
  state: args.state ?? ESessionStatus.RunningCommand,
  ...(args.reason === undefined ? {} : { reason: args.reason }),
  since: CONSUMED,
  lease: { epoch: 1, holderHostId: 1, live: true },
  commands: [...args.commands],
})

describe('blockingCommandOf', () => {
  it('names a running summarise and times it from the consume', () => {
    const status = statusWith({ commands: [row('summarise')], reason: 'summarise' })
    expect(blockingCommandOf(status)).toEqual({
      inboxId: 105,
      name: 'summarise',
      startedAt: CONSUMED,
      copy: { label: 'Summarising history', queued: 'Waits for the summary' },
    })
  })

  it('times from the post when the status names another state', () => {
    const status = statusWith({ commands: [row('rewind')], state: ESessionStatus.Queued })
    expect(blockingCommandOf(status)?.startedAt).toBe(POSTED)
  })

  it('ignores a queued command and a command that does not hold the turn', () => {
    const status = statusWith({
      commands: [row('summarise', ECommandState.Queued), row('rename')],
      state: ESessionStatus.Idle,
    })
    expect(blockingCommandOf(status)).toBeUndefined()
  })

  it('has nothing without a status', () => {
    expect(blockingCommandOf(undefined)).toBeUndefined()
  })
})

describe('elapsedClockOf', () => {
  it('reads minutes and padded seconds', () => {
    const now = Date.parse(CONSUMED) + 112_400
    expect(elapsedClockOf({ startedAt: CONSUMED, now })).toBe('1:52')
  })

  it('never goes below zero', () => {
    expect(elapsedClockOf({ startedAt: CONSUMED, now: Date.parse(CONSUMED) - 5000 })).toBe('0:00')
  })
})
