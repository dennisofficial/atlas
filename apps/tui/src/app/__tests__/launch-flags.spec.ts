import { describe, expect, test } from 'bun:test'

import type { StreamSessionRow } from '@dltech/atlas-protocol'

import { EOpenMode, launchFlagsOf, resumeTargetOf } from '../launch-flags'

const rowOf = (args: {
  sessionId: string
  title: string | null
  updatedAt: string
  archivedAt?: string | null
}): StreamSessionRow => ({
  sessionId: args.sessionId,
  projectId: null,
  title: args.title,
  naming: false,
  mainThreadId: 'thread-1',
  createdAt: args.updatedAt,
  updatedAt: args.updatedAt,
  archivedAt: args.archivedAt ?? null,
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
    expect(resumeTargetOf({ rows: ROWS, open: { mode: EOpenMode.Continue } })?.sessionId).toBe(
      'session-xyz',
    )
  })

  test('a fresh launch targets nothing', () => {
    expect(resumeTargetOf({ rows: ROWS, open: { mode: EOpenMode.New } })).toBeNull()
  })
})
