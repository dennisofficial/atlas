import { describe, expect, it } from 'bun:test'
import { initialFailureMessage, initialSessionViewState } from '@dltech/atlas-core'

import { memorySessionLog } from '../session-log'
import { gcSessionLog, sessionLogDeletionsOf } from '../session-log-gc'

describe('session log garbage collection', () => {
  it('deletes archived sessions only', () => {
    expect(
      sessionLogDeletionsOf({
        cached: ['live', 'archived'],
        sessions: [
          { sessionId: 'live', archived: false },
          { sessionId: 'archived', archived: true },
        ],
      }),
    ).toEqual(['archived'])
  })

  it('keeps sessions that fall outside the limited session list', () => {
    expect(
      sessionLogDeletionsOf({
        cached: ['newest', 'older-than-the-list-limit'],
        sessions: [{ sessionId: 'newest', archived: false }],
      }),
    ).toEqual([])
  })

  it('keeps every cached session that is still live', () => {
    expect(
      sessionLogDeletionsOf({
        cached: ['one', 'two'],
        sessions: [
          { sessionId: 'one', archived: false },
          { sessionId: 'two', archived: false },
        ],
      }),
    ).toEqual([])
  })

  it('deletes the caches the reconciliation names', async () => {
    const log = memorySessionLog()
    await log.saveSnapshot({ sessionId: 'keep', snapshot: snapshotOf() })
    await log.saveSnapshot({ sessionId: 'drop', snapshot: snapshotOf() })

    await gcSessionLog({
      log,
      sessions: [
        { sessionId: 'keep', archived: false },
        { sessionId: 'drop', archived: true },
      ],
    })

    expect(await log.listSessions()).toEqual(['keep'])
  })
})

const snapshotOf = () => ({
  version: 3,
  cursor: { seq: 1, hash: 'h' },
  visibility: { spans: [] },
  pending: { pending: [] },
  view: initialSessionViewState,
  failureMessage: initialFailureMessage,
  durable: [],
  commandLog: [],
  throughSeq: 1,
})
