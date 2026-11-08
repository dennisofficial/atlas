import { describe, expect, it } from 'bun:test'

import {
  backgroundWaitLabel,
  isWaiting,
  NOTHING_IN_BACKGROUND,
  waitStartedAt,
} from '../background-wait'

const SETTLED_AT = '2026-11-08T10:00:00.000Z'

describe('what a settled session says about the work it left running', () => {
  it('says nothing when nothing is left running', () => {
    expect(backgroundWaitLabel({ work: NOTHING_IN_BACKGROUND })).toBeNull()
  })

  it('counts agents alone', () => {
    expect(backgroundWaitLabel({ work: { subagents: 2, shells: 0 } })).toBe(
      'Waiting for 2 background agents to finish',
    )
  })

  it('counts shells alone', () => {
    expect(backgroundWaitLabel({ work: { subagents: 0, shells: 3 } })).toBe(
      'Waiting for 3 shells to finish',
    )
  })

  it('joins the two kinds when both are running', () => {
    expect(backgroundWaitLabel({ work: { subagents: 2, shells: 1 } })).toBe(
      'Waiting for 2 background agents and 1 shell to finish',
    )
  })

  it('drops the plural on a single one of either', () => {
    expect(backgroundWaitLabel({ work: { subagents: 1, shells: 1 } })).toBe(
      'Waiting for 1 background agent and 1 shell to finish',
    )
  })
})

describe('how long the wait itself has run', () => {
  it('appends the elapsed reading when one is on offer', () => {
    expect(backgroundWaitLabel({ work: { subagents: 0, shells: 1 }, waitedMs: 64_000 })).toBe(
      'Waiting for 1 shell to finish · 1m 4s',
    )
  })

  it('leaves the sentence bare when nothing has been timed yet', () => {
    expect(backgroundWaitLabel({ work: { subagents: 0, shells: 1 } })).toBe(
      'Waiting for 1 shell to finish',
    )
  })

  it('is only waiting when something is actually outstanding', () => {
    expect(isWaiting(NOTHING_IN_BACKGROUND)).toBe(false)
    expect(isWaiting({ subagents: 0, shells: 1 })).toBe(true)
    expect(isWaiting({ subagents: 1, shells: 0 })).toBe(true)
  })
})

describe('where a client takes the wait from', () => {
  it('times the wait from the instant the turn settled, whatever this client watched', () => {
    const mountedLate = Date.parse(SETTLED_AT) + 600_000

    expect(waitStartedAt({ settledAt: SETTLED_AT, held: mountedLate })).toBe(Date.parse(SETTLED_AT))
  })

  it('falls back to the origin this client held when the transcript carries no timestamp', () => {
    expect(waitStartedAt({ held: 1_000 })).toBe(1_000)
  })

  it('falls back when the stored timestamp cannot be read', () => {
    expect(waitStartedAt({ settledAt: 'yesterday', held: 1_000 })).toBe(1_000)
  })
})
