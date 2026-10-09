import { describe, expect, it } from 'bun:test'
import { EPrEventKind } from '@dltech/atlas-core'

import { createPrEventDedupe, type PrEventCandidate } from '../pr-event-dedupe'

const candidate = (over: Partial<PrEventCandidate> & Pick<PrEventCandidate, 'id' | 'kind'>): PrEventCandidate => ({
  repo: 'github.com/owner/repo',
  prNumber: 7,
  ...over,
})

describe('createPrEventDedupe', () => {
  it('admits a verdict once however often it is repeated under new ids', () => {
    const dedupe = createPrEventDedupe()
    const green = { kind: EPrEventKind.Verdict, verdict: 'green' }

    expect(dedupe.admit(candidate({ id: 'a', ...green }))).toBe(true)
    expect(dedupe.admit(candidate({ id: 'b', ...green }))).toBe(false)
  })

  it('admits a flip-flop verdict each time it changes', () => {
    const dedupe = createPrEventDedupe()
    const verdict = (id: string, value: string) => candidate({ id, kind: EPrEventKind.Verdict, verdict: value })

    expect(dedupe.admit(verdict('a', 'green'))).toBe(true)
    expect(dedupe.admit(verdict('b', 'failed'))).toBe(true)
    expect(dedupe.admit(verdict('c', 'green'))).toBe(true)
  })

  it('tracks mergeability and state independently of verdict', () => {
    const dedupe = createPrEventDedupe()

    expect(dedupe.admit(candidate({ id: 'a', kind: EPrEventKind.Mergeability, mergeable: false }))).toBe(true)
    expect(dedupe.admit(candidate({ id: 'b', kind: EPrEventKind.Mergeability, mergeable: false }))).toBe(false)
    expect(dedupe.admit(candidate({ id: 'c', kind: EPrEventKind.Mergeability, mergeable: true }))).toBe(true)
    expect(dedupe.admit(candidate({ id: 'd', kind: EPrEventKind.State, state: 'merged' }))).toBe(true)
    expect(dedupe.admit(candidate({ id: 'e', kind: EPrEventKind.State, state: 'merged' }))).toBe(false)
  })

  it('keeps transition readings per pull request', () => {
    const dedupe = createPrEventDedupe()
    const green = { kind: EPrEventKind.Verdict, verdict: 'green' }

    expect(dedupe.admit(candidate({ id: 'a', prNumber: 1, ...green }))).toBe(true)
    expect(dedupe.admit(candidate({ id: 'b', prNumber: 2, ...green }))).toBe(true)
  })

  it('admits a comment once by frame id and every distinct comment', () => {
    const dedupe = createPrEventDedupe()

    expect(dedupe.admit(candidate({ id: 'c1', kind: EPrEventKind.Comment }))).toBe(true)
    expect(dedupe.admit(candidate({ id: 'c1', kind: EPrEventKind.Comment }))).toBe(false)
    expect(dedupe.admit(candidate({ id: 'c2', kind: EPrEventKind.Comment }))).toBe(true)
    expect(dedupe.admit(candidate({ id: 'r1', kind: EPrEventKind.Review }))).toBe(true)
    expect(dedupe.admit(candidate({ id: 'rc1', kind: EPrEventKind.ReviewComment }))).toBe(true)
  })

  it('does not let a replayed id resurface a transition it already consumed', () => {
    const dedupe = createPrEventDedupe()
    const verdict = (id: string, value: string) => candidate({ id, kind: EPrEventKind.Verdict, verdict: value })

    dedupe.admit(verdict('a', 'green'))
    dedupe.admit(verdict('b', 'failed'))

    expect(dedupe.admit(verdict('a', 'green'))).toBe(false)
  })

  it('forgets ids beyond its bound rather than growing forever', () => {
    const dedupe = createPrEventDedupe()
    for (let index = 0; index < 250; index += 1) {
      dedupe.admit(candidate({ id: `c${index}`, kind: EPrEventKind.Comment }))
    }

    expect(dedupe.admit(candidate({ id: 'c249', kind: EPrEventKind.Comment }))).toBe(false)
    expect(dedupe.admit(candidate({ id: 'c0', kind: EPrEventKind.Comment }))).toBe(true)
  })
})
