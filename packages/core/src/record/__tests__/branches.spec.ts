import { describe, expect, it } from 'bun:test'

import { chainEvents } from '../chain-events'
import { branchesChanged, branchesObservedSchema, type BranchObservation } from '../branches'
import { v2EventSchema } from '../event'
import { NOW, runId, threadId } from './support'

const observation = (overrides: Partial<BranchObservation> = {}): BranchObservation => ({
  repo: '/w',
  head: 'aaa111',
  branches: [
    { name: 'main', sha: 'aaa111' },
    { name: 'feat-x', sha: 'bbb222' },
  ],
  worktrees: [{ path: '/w', branch: 'main', sha: 'aaa111', detached: false }],
  ...overrides,
})

const recorded = (set: BranchObservation) =>
  chainEvents({
    threadId,
    runId,
    epoch: 3,
    at: NOW,
    bodies: [{ type: 'branches-observed', ...set }],
  })

describe('branchesObservedSchema', () => {
  it('round-trips a branches-observed record through the v2 event schema', () => {
    const [event] = recorded(observation())
    expect(event?.type).toBe('branches-observed')
    const parsed = v2EventSchema.parse(event)
    expect(parsed.type).toBe('branches-observed')
  })

  it('rejects a missing head field', () => {
    const { head: _head, ...rest } = observation()
    expect(branchesObservedSchema.safeParse({ type: 'branches-observed', ...rest }).success).toBe(
      false,
    )
  })
})

describe('branchesChanged', () => {
  it('is true when the repo was never observed', () => {
    expect(branchesChanged({ events: [], set: observation() })).toBe(true)
  })

  it('is false when the set matches the last observation for the repo', () => {
    const events = recorded(observation())
    expect(branchesChanged({ events, set: observation() })).toBe(false)
  })

  it('ignores branch order when comparing', () => {
    const events = recorded(observation())
    const reordered = observation({ branches: [...observation().branches].reverse() })
    expect(branchesChanged({ events, set: reordered })).toBe(false)
  })

  it('is true when a branch appears', () => {
    const events = recorded(observation())
    const grown = observation({
      branches: [...observation().branches, { name: 'feat-y', sha: 'ccc333' }],
    })
    expect(branchesChanged({ events, set: grown })).toBe(true)
  })

  it('is true when head moved', () => {
    const events = recorded(observation())
    expect(branchesChanged({ events, set: observation({ head: 'zzz999' }) })).toBe(true)
  })

  it('tracks each repo independently', () => {
    const events = recorded(observation({ repo: '/other' }))
    expect(branchesChanged({ events, set: observation() })).toBe(true)
  })

  it('compares against the latest observation only', () => {
    const events = [...recorded(observation({ head: 'old' })), ...recorded(observation())]
    expect(branchesChanged({ events, set: observation() })).toBe(false)
  })
})
