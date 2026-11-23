import { describe, expect, test } from 'bun:test'

import { EExecutionLocation } from '@dltech/atlas-core'
import type { StreamSessionRow } from '@dltech/atlas-protocol'

import { sessionRowsOf } from '../session-rows'

const rowOf = (args: {
  sessionId: string
  title?: string | null
  updatedAt: string
  archivedAt?: string | null
  spawnedBy?: string | null
}): StreamSessionRow => ({
  sessionId: args.sessionId,
  projectId: null,
  title: args.title ?? null,
  naming: false,
  mainThreadId: 'thread-1',
  createdAt: args.updatedAt,
  updatedAt: args.updatedAt,
  archivedAt: args.archivedAt ?? null,
  model: { ref: 'claude-sonnet-4-5', effort: 'high', fast: false },
  ...(args.spawnedBy === undefined ? {} : { spawnedBy: args.spawnedBy }),
})

const NOW = 1_700_000_000_000

describe('sessionRowsOf', () => {
  test('labels a titled row by its title and an untitled one by its id', () => {
    const rows = sessionRowsOf({
      rows: [
        rowOf({
          sessionId: 'session-1',
          title: '  Fix the flaky test  ',
          updatedAt: '2026-11-01T00:00:00.000Z',
        }),
        rowOf({ sessionId: 'session-2', title: '   ', updatedAt: '2026-11-02T00:00:00.000Z' }),
        rowOf({ sessionId: 'session-3', updatedAt: '2026-11-03T00:00:00.000Z' }),
      ],
      now: NOW,
      activeSessionId: null,
    })

    expect(rows.map((row) => [row.label, row.titled])).toEqual([
      ['session-3', false],
      ['session-2', false],
      ['Fix the flaky test', true],
    ])
  })

  test('drops archived rows and rows a teammate owns, newest first', () => {
    const rows = sessionRowsOf({
      rows: [
        rowOf({ sessionId: 'old', updatedAt: '2026-11-01T00:00:00.000Z' }),
        rowOf({ sessionId: 'new', updatedAt: '2026-11-20T00:00:00.000Z' }),
        rowOf({
          sessionId: 'archived',
          updatedAt: '2026-11-21T00:00:00.000Z',
          archivedAt: '2026-11-22T00:00:00.000Z',
        }),
        rowOf({
          sessionId: 'teammate',
          updatedAt: '2026-11-22T00:00:00.000Z',
          spawnedBy: 'parent-1',
        }),
      ],
      now: NOW,
      activeSessionId: null,
    })

    expect(rows.map((row) => row.threadId)).toEqual(['new', 'old'])
  })

  test('marks the open session active and places every row in the cloud', () => {
    const rows = sessionRowsOf({
      rows: [
        rowOf({ sessionId: 'session-1', updatedAt: '2026-11-01T00:00:00.000Z' }),
        rowOf({ sessionId: 'session-2', updatedAt: '2026-11-02T00:00:00.000Z' }),
      ],
      now: NOW,
      activeSessionId: 'session-1',
    })

    expect(rows.map((row) => row.active)).toEqual([false, true])
    expect(rows.every((row) => row.location === EExecutionLocation.Cloud)).toBe(true)
  })
})
