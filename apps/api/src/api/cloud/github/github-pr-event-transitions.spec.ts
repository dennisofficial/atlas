import { describe, expect, it } from 'vitest'
import { EPrEventKind } from './github-realtime.types'
import {
  transitionsOf,
  type PrTransitionEvent,
  type PrTransitionSnapshot,
} from './github-pr-event-transitions'

const base = { state: 'open', headSha: 'abc', url: 'https://x' }

const runningNoMergeable: PrTransitionSnapshot = {
  state: 'open',
  headSha: 'abc',
  checksRunning: 10,
  checksPassed: 0,
  checksFailed: 0,
  mergeable: null,
}

function kindsOf(events: PrTransitionEvent[]): EPrEventKind[] {
  return events.map((event) => event.kind)
}

describe('transitionsOf', () => {
  it('emits nothing for a brand-new row', () => {
    expect(
      transitionsOf({
        prior: null,
        next: { ...base, checksRunning: 0, checksPassed: 3, checksFailed: 0, mergeable: true },
      }),
    ).toEqual([])
  })

  it('fail-fast default emits failed verdict on the 0→1 failure crossing while checks still run', () => {
    const events = transitionsOf({
      prior: runningNoMergeable,
      next: { ...base, checksRunning: 9, checksPassed: 0, checksFailed: 1, mergeable: null },
    })
    expect(kindsOf(events)).toEqual([EPrEventKind.Verdict])
    expect(events[0]?.payload.verdict).toBe('failed')
  })

  it('fail-fast default emits a green verdict only on settle with zero failures', () => {
    const events = transitionsOf({
      prior: runningNoMergeable,
      next: { ...base, checksRunning: 0, checksPassed: 10, checksFailed: 0, mergeable: null },
    })
    expect(events).toHaveLength(1)
    expect(events[0]?.payload.verdict).toBe('green')
  })

  it('fail-fast default emits no green verdict when the settle carries failures', () => {
    const events = transitionsOf({
      prior: { ...runningNoMergeable, checksFailed: 1 },
      next: { ...base, checksRunning: 0, checksPassed: 9, checksFailed: 1, mergeable: null },
    })
    expect(events).toEqual([])
  })

  it('suppresses the standalone mergeability flip while checks are still running', () => {
    const events = transitionsOf({
      prior: runningNoMergeable,
      next: { ...base, checksRunning: 5, checksPassed: 3, checksFailed: 0, mergeable: false },
    })
    expect(events).toEqual([])
  })

  it('bundles the mergeability flip with the settled green verdict', () => {
    const events = transitionsOf({
      prior: runningNoMergeable,
      next: { ...base, checksRunning: 0, checksPassed: 10, checksFailed: 0, mergeable: true },
    })
    expect(kindsOf(events)).toEqual([EPrEventKind.Verdict, EPrEventKind.Mergeability])
    expect(events[1]?.payload.mergeable).toBe(true)
  })

  it('emits mergeability at settle even when the flip resolves to false', () => {
    const events = transitionsOf({
      prior: runningNoMergeable,
      next: { ...base, checksRunning: 0, checksPassed: 10, checksFailed: 0, mergeable: false },
    })
    expect(kindsOf(events)).toEqual([EPrEventKind.Verdict, EPrEventKind.Mergeability])
    expect(events[1]?.payload.mergeable).toBe(false)
  })

  it('emits no mergeability event when the settled value stays null', () => {
    const events = transitionsOf({
      prior: runningNoMergeable,
      next: { ...base, checksRunning: 0, checksPassed: 10, checksFailed: 0, mergeable: null },
    })
    expect(kindsOf(events)).toEqual([EPrEventKind.Verdict])
  })

  it('emits mergeability immediately when the PR has no checks at all', () => {
    const events = transitionsOf({
      prior: { state: 'open', headSha: 'abc', checksRunning: 0, checksPassed: 0, checksFailed: 0, mergeable: null },
      next: { ...base, checksRunning: 0, checksPassed: 0, checksFailed: 0, mergeable: true },
    })
    expect(kindsOf(events)).toEqual([EPrEventKind.Mergeability])
  })

  it('emits no mergeability at settle when the value never changed from the prior row', () => {
    const events = transitionsOf({
      prior: { ...runningNoMergeable, mergeable: false, checksPassed: 7, checksRunning: 3 },
      next: { ...base, checksRunning: 0, checksPassed: 10, checksFailed: 0, mergeable: false },
    })
    expect(kindsOf(events)).toEqual([EPrEventKind.Verdict])
  })

  it('settled timing holds the verdict until settle and then announces failed', () => {
    const options = { verdictTiming: 'settled' as const }
    const midRun = transitionsOf({
      prior: runningNoMergeable,
      next: { ...base, checksRunning: 9, checksPassed: 0, checksFailed: 1, mergeable: null },
      options,
    })
    expect(midRun).toEqual([])

    const settled = transitionsOf({
      prior: { ...runningNoMergeable, checksFailed: 1 },
      next: { ...base, checksRunning: 0, checksPassed: 9, checksFailed: 1, mergeable: true },
      options,
    })
    expect(kindsOf(settled)).toEqual([EPrEventKind.Verdict, EPrEventKind.Mergeability])
    expect(settled[0]?.payload.verdict).toBe('failed')
  })

  it('settled timing announces green at settle and repeats no verdict on a steady re-read', () => {
    const options = { verdictTiming: 'settled' as const }
    const settled = transitionsOf({
      prior: runningNoMergeable,
      next: { ...base, checksRunning: 0, checksPassed: 10, checksFailed: 0, mergeable: null },
      options,
    })
    expect(settled).toHaveLength(1)
    expect(settled[0]?.payload.verdict).toBe('green')

    const steady = transitionsOf({
      prior: { state: 'open', headSha: 'abc', checksRunning: 0, checksPassed: 10, checksFailed: 0, mergeable: null },
      next: { ...base, checksRunning: 0, checksPassed: 10, checksFailed: 0, mergeable: null },
      options,
    })
    expect(steady).toEqual([])
  })

  it('emits a state event when the PR merges or closes, regardless of timing', () => {
    for (const timing of ['fail-fast', 'settled'] as const) {
      const events = transitionsOf({
        prior: { state: 'open', headSha: 'abc', checksRunning: 0, checksPassed: 3, checksFailed: 0, mergeable: true },
        next: { state: 'merged', headSha: 'abc', url: 'https://x', checksRunning: 0, checksPassed: 3, checksFailed: 0, mergeable: true },
        options: { verdictTiming: timing },
      })
      expect(kindsOf(events)).toEqual([EPrEventKind.State])
      expect(events[0]?.payload.state).toBe('merged')
    }
  })
})
