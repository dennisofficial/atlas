import { describe, expect, it } from 'bun:test'

import {
  chainEvents,
  observationChanged,
  toRunId,
  toThreadId,
  type BranchObservation,
} from '@dltech/atlas-core'

import { RecordBookkeeping } from '../record-bookkeeping'

const THREAD = toThreadId('thread-1')

const observation: BranchObservation = {
  repo: '/w',
  head: 'feat-x',
  base: 'main',
  branches: [
    { name: 'feat-x', sha: 'bbb222', pushRemote: 'fork' },
    { name: 'main', sha: 'aaa111', pushRemote: null },
  ],
  worktrees: [{ path: '/w', branch: 'feat-x', sha: 'bbb222', detached: false }],
  remotes: [
    { name: 'fork', url: 'git@github.com:me/app.git' },
    { name: 'origin', url: 'git@github.com:acme/app.git' },
  ],
  checkouts: ['feat-x', 'main'],
}

const bookkeepingWith = (set: BranchObservation): RecordBookkeeping => {
  const [event] = chainEvents({
    threadId: THREAD,
    runId: toRunId('run-1'),
    epoch: 1,
    at: '2026-11-06T12:00:00.000Z',
    bodies: [{ type: 'branches-observed', ...set }],
  })
  const book = new RecordBookkeeping()
  if (event !== undefined) book.step(event)
  return book
}

describe('RecordBookkeeping branches', () => {
  it('keeps every observed field so an unchanged repo reads as unchanged', () => {
    const book = bookkeepingWith(observation)
    const last = book.lastObservation('/w')

    expect(last).toEqual(observation)
    expect(observationChanged({ last, set: observation })).toBe(false)
  })

  it('reports a change when only a checkout or a remote moved', () => {
    const book = bookkeepingWith(observation)
    const last = book.lastObservation('/w')

    expect(observationChanged({ last, set: { ...observation, checkouts: ['feat-x'] } })).toBe(true)
    expect(
      observationChanged({ last, set: { ...observation, remotes: observation.remotes?.slice(1) } }),
    ).toBe(true)
  })
})
