import { describe, expect, it } from 'bun:test'
import {
  headSettled,
  transitionsOf,
  verdictMergeability,
  type PrTransitionEvent,
  type PrTransitionSnapshot,
} from './github-pr-event-transitions'
import { EPrEventKind } from './github-realtime.types'

const base = { state: 'open', headSha: 'abc', url: 'https://x', checksIgnored: 0 }

const runningNoMergeable: PrTransitionSnapshot = {
  state: 'open',
  headSha: 'abc',
  checksRunning: 10,
  checksPassed: 0,
  checksFailed: 0,
  checksIgnored: 0,
  mergeable: null,
}

function kindsOf(events: PrTransitionEvent[]): EPrEventKind[] {
  return events.map((event) => event.kind)
}

describe('headSettled', () => {
  it('needs nothing running, something completed and no missing required check', () => {
    const green: PrTransitionSnapshot = {
      state: 'open',
      headSha: 'abc',
      checksRunning: 0,
      checksPassed: 1,
      checksFailed: 0,
      checksIgnored: 0,
      mergeable: null,
    }
    expect(headSettled(green)).toBe(true)
    expect(headSettled({ ...green, checksRunning: 1 })).toBe(false)
    expect(headSettled({ ...green, checksPassed: 0 })).toBe(false)
    expect(headSettled({ ...green, missingRequiredChecks: 1 })).toBe(false)
    expect(headSettled({ ...green, missingRequiredChecks: 0 })).toBe(true)
  })

  it('holds a settled tally that still owes a required check out of the new-tip verdict', () => {
    const events = transitionsOf({
      prior: { ...runningNoMergeable, headSha: 'old' },
      next: {
        ...base,
        checksRunning: 0,
        checksPassed: 5,
        checksFailed: 0,
        mergeable: null,
        missingRequiredChecks: 1,
      },
    })
    expect(kindsOf(events)).toEqual([])
  })
})

describe('verdictMergeability', () => {
  const settled: PrTransitionSnapshot = {
    state: 'open',
    headSha: 'abc',
    checksRunning: 0,
    checksPassed: 3,
    checksFailed: 0,
    checksIgnored: 0,
    mergeable: true,
  }

  it('says mergeable only when GitHub reports a clean merge state', () => {
    expect(verdictMergeability({ ...settled, mergeClean: true })).toEqual({ mergeable: true })
    expect(verdictMergeability({ ...settled, mergeClean: false })).toEqual({})
    expect(verdictMergeability({ ...settled, mergeClean: null })).toEqual({})
    expect(verdictMergeability(settled)).toEqual({})
  })
})
