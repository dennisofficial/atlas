import { describe, expect, test } from 'bun:test'

import type { StreamSessionRow } from '@dltech/atlas-protocol'

import {
  EOpenMode,
  EMissedEnd,
  continueTargetOf,
  launchFlagsOf,
  resolveOpen,
  resumeTargetOf,
} from '../launch-flags'

const rowOf = (args: {
  sessionId: string
  title: string | null
  updatedAt: string
  archivedAt?: string | null
  spawnedBy?: string
}): StreamSessionRow => ({
  sessionId: args.sessionId,
  projectId: null,
  title: args.title,
  naming: false,
  mainThreadId: 'thread-1',
  createdAt: args.updatedAt,
  updatedAt: args.updatedAt,
  archivedAt: args.archivedAt ?? null,
  ...(args.spawnedBy === undefined ? {} : { spawnedBy: args.spawnedBy }),
  model: { ref: 'anthropic/x', effort: 'high', fast: false },
})

describe('launchFlagsOf', () => {
  test('no flag opens a new session', () => {
    expect(launchFlagsOf({ argv: [] })).toEqual({ open: { mode: EOpenMode.New }, model: null })
  })

  test('-c and --continue both continue', () => {
    expect(launchFlagsOf({ argv: ['-c'] }).open).toEqual({ mode: EOpenMode.Continue })
    expect(launchFlagsOf({ argv: ['--continue'] }).open).toEqual({ mode: EOpenMode.Continue })
  })

  test('the flag survives the argv atlas-dev hands the app', () => {
    expect(launchFlagsOf({ argv: ['--cwd', '/work/project', '--continue'] }).open).toEqual({
      mode: EOpenMode.Continue,
    })
  })

  test('--resume takes the handle after it', () => {
    expect(launchFlagsOf({ argv: ['--resume', 'abc'] }).open).toEqual({
      mode: EOpenMode.Resume,
      handle: 'abc',
    })
  })

  test('a flag with no value is ignored', () => {
    expect(launchFlagsOf({ argv: ['--resume'] }).open).toEqual({ mode: EOpenMode.Continue })
    expect(launchFlagsOf({ argv: ['--resume', '--model'] }).open).toEqual({
      mode: EOpenMode.Continue,
    })
  })

  test('--model names the model this launch starts on', () => {
    expect(launchFlagsOf({ argv: ['--model', 'openai/gpt'] }).model).toBe('openai/gpt')
    expect(launchFlagsOf({ argv: ['--model'] }).model).toBeNull()
  })
})

describe('resumeTargetOf', () => {
  const ROWS: readonly StreamSessionRow[] = [
    rowOf({
      sessionId: 'session-abc',
      title: 'Fix the flaky test',
      updatedAt: '2026-11-01T00:00:00.000Z',
    }),
    rowOf({
      sessionId: 'session-xyz',
      title: 'Fix the flaky test',
      updatedAt: '2026-11-20T00:00:00.000Z',
    }),
    rowOf({
      sessionId: 'session-old',
      title: 'an older session',
      updatedAt: '2026-10-01T00:00:00.000Z',
    }),
    rowOf({
      sessionId: 'session-gone',
      title: 'archived work',
      updatedAt: '2026-11-22T00:00:00.000Z',
      archivedAt: '2026-11-22T00:00:00.000Z',
    }),
  ]

  test('an exact id wins', () => {
    const target = resumeTargetOf({
      rows: ROWS,
      open: { mode: EOpenMode.Resume, handle: 'session-abc' },
    })
    expect(target?.sessionId).toBe('session-abc')
  })

  test('a prefix matches, newest first', () => {
    const target = resumeTargetOf({
      rows: ROWS,
      open: { mode: EOpenMode.Resume, handle: 'session-' },
    })
    expect(target?.sessionId).toBe('session-gone')
  })

  test('a title matches case-insensitively and prefers the newest', () => {
    const target = resumeTargetOf({
      rows: ROWS,
      open: { mode: EOpenMode.Resume, handle: 'fix the flaky' },
    })
    expect(target?.sessionId).toBe('session-xyz')
  })

  test('a miss is null', () => {
    expect(
      resumeTargetOf({ rows: ROWS, open: { mode: EOpenMode.Resume, handle: 'nothing' } }),
    ).toBeNull()
  })

  test('continue opens the newest live session', () => {
    expect(resumeTargetOf({ rows: ROWS, open: { mode: EOpenMode.Continue } })).toBeNull()
  })

  test('a fresh launch targets nothing', () => {
    expect(resumeTargetOf({ rows: ROWS, open: { mode: EOpenMode.New } })).toBeNull()
  })
})

describe('continueTargetOf', () => {
  const ROWS: readonly StreamSessionRow[] = [
    rowOf({
      sessionId: 'session-a',
      title: 'finished later',
      updatedAt: '2026-11-20T00:00:00.000Z',
    }),
    rowOf({
      sessionId: 'session-b',
      title: 'the one I had open',
      updatedAt: '2026-11-01T00:00:00.000Z',
    }),
    rowOf({
      sessionId: 'session-old',
      title: 'an older session',
      updatedAt: '2026-10-01T00:00:00.000Z',
    }),
  ]

  test('opens the last session of this machine, not the newest', () => {
    const target = continueTargetOf({ rows: ROWS, lastSessionId: 'session-b' })
    expect(target.row?.sessionId).toBe('session-b')
    expect(target.missed).toBeNull()
  })

  test('falls back to the newest when nothing was recorded', () => {
    const target = continueTargetOf({ rows: ROWS, lastSessionId: null })
    expect(target.row?.sessionId).toBe('session-a')
    expect(target.missed).toBeNull()
  })

  test('an archived last session falls back to the newest and says why', () => {
    const rows = ROWS.map((row) =>
      row.sessionId === 'session-b' ? { ...row, archivedAt: '2026-11-22T00:00:00.000Z' } : row,
    )
    const target = continueTargetOf({ rows, lastSessionId: 'session-b' })
    expect(target.row?.sessionId).toBe('session-a')
    expect(target.missed).toBe(EMissedEnd.LastArchived)
  })

  test('a last session no longer listed falls back to the newest and says why', () => {
    const target = continueTargetOf({ rows: ROWS, lastSessionId: 'session-gone' })
    expect(target.row?.sessionId).toBe('session-a')
    expect(target.missed).toBe(EMissedEnd.LastNotListed)
  })

  test('a sub-agent session is never the fallback', () => {
    const rows = [
      rowOf({
        sessionId: 'session-sub',
        title: 'a sub-agent',
        updatedAt: '2026-11-23T00:00:00.000Z',
        spawnedBy: 'session-a',
      }),
      ...ROWS,
    ]
    expect(continueTargetOf({ rows, lastSessionId: null }).row?.sessionId).toBe('session-a')
  })

  test('an empty list resolves to nothing', () => {
    expect(continueTargetOf({ rows: [], lastSessionId: 'session-b' })).toEqual({
      row: null,
      missed: EMissedEnd.LastNotListed,
    })
  })
})

describe('resolveOpen', () => {
  test('a resume miss is reported as such', () => {
    expect(
      resolveOpen({
        rows: [],
        open: { mode: EOpenMode.Resume, handle: 'nothing' },
        lastSessionId: null,
      }),
    ).toEqual({ row: null, missed: EMissedEnd.ResumeUnknown })
  })

  test('a new session resolves to nothing', () => {
    expect(
      resolveOpen({ rows: [], open: { mode: EOpenMode.New }, lastSessionId: 'session-b' }),
    ).toEqual({ row: null, missed: null })
  })
})
