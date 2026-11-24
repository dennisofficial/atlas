import { describe, expect, test } from 'bun:test'

import { ESessionStatus } from '@dltech/atlas-core'
import type { StreamSessionRow } from '@dltech/atlas-protocol'

import { finishedNoticesOf } from '../session-notices'

const row = (patch: Partial<StreamSessionRow>): StreamSessionRow => ({
  sessionId: 'session-two',
  projectId: null,
  title: 'the other session',
  naming: false,
  mainThreadId: 'thread-2',
  createdAt: '2026-11-20T00:00:00.000Z',
  updatedAt: '2026-11-20T00:00:00.000Z',
  archivedAt: null,
  model: { ref: 'claude-sonnet-4-5', effort: 'high', fast: false },
  ...patch,
})

const withState = (state: ESessionStatus, patch: Partial<StreamSessionRow> = {}) =>
  row({ status: { state }, ...patch })

describe('notices for other sessions', () => {
  test('thinking to idle notifies', () => {
    const notices = finishedNoticesOf({
      previous: [withState(ESessionStatus.Thinking)],
      next: [withState(ESessionStatus.Idle)],
      watching: 'session-one',
    })
    expect(notices).toEqual([{ key: 'session-session-two', text: 'the other session finished' }])
  })

  test('a failure says failed', () => {
    const notices = finishedNoticesOf({
      previous: [withState(ESessionStatus.RunningTool)],
      next: [withState(ESessionStatus.Failed)],
      watching: null,
    })
    expect(notices[0]?.text).toBe('the other session failed')
  })

  test('idle to idle does not notify', () => {
    const notices = finishedNoticesOf({
      previous: [withState(ESessionStatus.Idle)],
      next: [withState(ESessionStatus.Idle)],
      watching: null,
    })
    expect(notices).toHaveLength(0)
  })

  test('the watched session does not notify', () => {
    const notices = finishedNoticesOf({
      previous: [withState(ESessionStatus.Thinking)],
      next: [withState(ESessionStatus.Idle)],
      watching: 'session-two',
    })
    expect(notices).toHaveLength(0)
  })

  test('a row with no status does not notify', () => {
    const notices = finishedNoticesOf({ previous: [row({})], next: [row({})], watching: null })
    expect(notices).toHaveLength(0)
  })

  test('an archived row does not notify', () => {
    const notices = finishedNoticesOf({
      previous: [withState(ESessionStatus.Thinking)],
      next: [withState(ESessionStatus.Idle, { archivedAt: '2026-11-20T01:00:00.000Z' })],
      watching: null,
    })
    expect(notices).toHaveLength(0)
  })
})
